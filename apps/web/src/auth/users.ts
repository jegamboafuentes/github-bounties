import { eq } from "drizzle-orm";
import type { EnvMap } from "./env";
import type { Database } from "../db/client";
import { isMissingIdentitySchema } from "../db/errors";
import { getRuntimeDb } from "../db/runtime";
import { users } from "../db/schema";
import { dispatchEmailOutbox } from "../email/dispatch";
import { transactionalEmailEnabled } from "../email/env";
import { enqueueWelcomeOnce, syncPendingRecipient, welcomeIdempotencyKey } from "../email/outbox";

export type GoogleIdentity = {
  googleSub: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
};

export type UserRow = typeof users.$inferSelect;

function normalizeAvatarUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Create or update the product User keyed by google_sub.
 * Email and display_name refresh on each login. Avatar refreshes when Google sends one.
 * The first insert also enqueues the welcome email once. Repeat logins do not insert
 * another user or another welcome. Dispatch is best-effort and never blocks sign-in.
 *
 * If migrate `0006_user_identity_email_outbox` is not applied yet, fall back to the
 * pre-outbox upsert so a revision without that migrate still lets people sign in.
 */
export async function upsertUserByGoogleSub(
  identity: GoogleIdentity,
  db: Database = getRuntimeDb(),
  env: EnvMap = process.env,
): Promise<UserRow> {
  const googleSub = identity.googleSub.trim();
  const email = identity.email.trim();
  const displayName = identity.displayName.trim() || email.split("@")[0] || "Google user";
  const avatarUrl = normalizeAvatarUrl(identity.avatarUrl);

  if (!googleSub) {
    throw new Error("google_sub is required to persist a user");
  }
  if (!email) {
    throw new Error("email is required to persist a user");
  }

  try {
    const user = await upsertWithWelcome(db, env, { googleSub, email, displayName, avatarUrl });
    await safeDispatch(db, env, user.id);
    return user;
  } catch (err) {
    if (!isMissingIdentitySchema(err)) throw err;
    console.error(
      "sign-in identity columns or email_outbox missing; saved google_sub without welcome",
    );
    return upsertLegacy(db, { googleSub, email, displayName });
  }
}

async function upsertWithWelcome(
  db: Database,
  env: EnvMap,
  identity: { googleSub: string; email: string; displayName: string; avatarUrl: string | null },
): Promise<UserRow> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({
        googleSub: identity.googleSub,
        email: identity.email,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        lastSeenAt: new Date(),
      })
      .onConflictDoNothing({ target: users.googleSub })
      .returning();

    if (inserted[0]) {
      if (transactionalEmailEnabled(env)) {
        await enqueueWelcomeOnce(tx, inserted[0], env);
      }
      return inserted[0];
    }

    const patch: {
      email: string;
      displayName: string;
      avatarUrl?: string;
      lastSeenAt: Date;
      updatedAt: Date;
    } = {
      email: identity.email,
      displayName: identity.displayName,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    };
    if (identity.avatarUrl) patch.avatarUrl = identity.avatarUrl;

    const [updated] = await tx
      .update(users)
      .set(patch)
      .where(eq(users.googleSub, identity.googleSub))
      .returning();
    if (!updated) {
      throw new Error("upsert users.google_sub returned no row");
    }
    if (transactionalEmailEnabled(env)) {
      await syncPendingRecipient(tx, {
        idempotencyKey: welcomeIdempotencyKey(updated.id),
        toEmail: updated.email,
      });
    }
    return updated;
  });
}

/** Pre-0006 shape: google_sub, email, display_name only. No welcome. */
async function upsertLegacy(
  db: Database,
  identity: { googleSub: string; email: string; displayName: string },
): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({
      googleSub: identity.googleSub,
      email: identity.email,
      displayName: identity.displayName,
    })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: {
        email: identity.email,
        displayName: identity.displayName,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) {
    throw new Error("upsert users.google_sub returned no row");
  }
  return row;
}

async function safeDispatch(db: Database, env: EnvMap, userId: string): Promise<void> {
  try {
    await dispatchEmailOutbox({ db, env, userId, limit: 5 });
  } catch {
    console.error("transactional email dispatch skipped");
  }
}

export async function findUserById(
  id: string,
  db: Database = getRuntimeDb(),
): Promise<UserRow | null> {
  if (!id) return null;
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

/** Persist a BYO Base payout address on the signed-in user. Does not touch last_seen_at. */
export async function setUserWalletAddress(
  userId: string,
  walletAddress: string,
  db: Database = getRuntimeDb(),
): Promise<UserRow> {
  const [row] = await db
    .update(users)
    .set({ walletAddress, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!row) {
    throw new Error("user not found");
  }
  return row;
}

export function identityFromGoogleProfile(profile: {
  sub?: string | null;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
  email_verified?: boolean | null;
}): GoogleIdentity | null {
  const googleSub = profile.sub?.trim() ?? "";
  const email = profile.email?.trim() ?? "";
  if (!googleSub || !email) return null;
  if (profile.email_verified === false) return null;
  const displayName = profile.name?.trim() || email.split("@")[0] || "Google user";
  return {
    googleSub,
    email,
    displayName,
    avatarUrl: normalizeAvatarUrl(profile.picture),
  };
}
