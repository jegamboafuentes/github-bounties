/**
 * After a successful Google upsert, enqueue the welcome exactly once and
 * try to deliver this user's pending mail. Email failures never throw —
 * sign-in still returns the user.
 */

import { eq } from "drizzle-orm";
import type { EnvMap } from "../auth/env";
import type { GoogleIdentity, UpsertUserOptions, UserRow } from "../auth/users";
import { upsertUserByGoogleSub } from "../auth/users";
import type { Database } from "../db/client";
import { getRuntimeDb } from "../db/runtime";
import { users } from "../db/schema";
import type { TransactionalEmailAdapter } from "./adapter";
import { deliverOutbox, enqueueEmailForUser } from "./outbox";
import { welcomeIdempotencyKey } from "./templates";

function logEmailFailure(userId: string, error: string): void {
  console.error(
    JSON.stringify({
      event: "sign_in_email_failed",
      userId,
      error: error.slice(0, 300),
    }),
  );
}

async function stampWelcomeEnqueued(userId: string, db: Database, now: Date): Promise<void> {
  await db
    .update(users)
    .set({ welcomeEnqueuedAt: now, updatedAt: now })
    .where(eq(users.id, userId));
}

/**
 * Upsert `users` by google_sub, then welcome-once.
 * Existing rows stamped by migration 0006 are not welcomed retroactively.
 * A failed enqueue leaves `welcome_enqueued_at` null so the next login retries
 * without inserting a second user.
 */
export async function persistGoogleSignIn(
  identity: GoogleIdentity,
  deps: {
    db?: Database;
    env?: EnvMap;
    adapter?: TransactionalEmailAdapter;
    now?: Date;
  } = {},
): Promise<UserRow> {
  const db = deps.db ?? getRuntimeDb();
  const now = deps.now ?? new Date();
  const options: UpsertUserOptions = { now };
  const { user, created } = await upsertUserByGoogleSub(identity, db, options);

  try {
    const needsWelcome = created || user.welcomeEnqueuedAt == null;
    if (needsWelcome) {
      const enqueued = await enqueueEmailForUser(
        {
          userId: user.id,
          template: "welcome",
          idempotencyKey: welcomeIdempotencyKey(user.id),
          payload: { displayName: user.displayName },
        },
        db,
      );
      if (enqueued.ok || enqueued.reason === "rejected_recipient") {
        await stampWelcomeEnqueued(user.id, db, now);
      }
    }

    await deliverOutbox({
      db,
      env: deps.env,
      adapter: deps.adapter,
      userId: user.id,
      limit: 5,
    });
  } catch (err) {
    logEmailFailure(user.id, err instanceof Error ? err.message : "email_failed");
  }

  return user;
}
