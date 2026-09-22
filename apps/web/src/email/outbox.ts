/**
 * Enqueue transactional mail. Recipients come only from the signed-up user row
 * (`users.email`, Google sign-in). This module never calls GitHub.
 */

import { and, eq } from "drizzle-orm";
import type { EnvMap } from "../auth/env";
import type { Database } from "../db/client";
import { emailOutbox, type EmailOutboxTemplate } from "../db/schema";
import { readEmailBaseUrl } from "./env";
import { renderWelcomeEmail } from "./templates";

export type EmailWriter = Pick<Database, "insert" | "update">;

/**
 * Address stored on the product user. Blank or non-email values are not recipients.
 * Do not pass a GitHub profile email, noreply address scraped from the API, or
 * any address that is not `users.email`.
 */
export function recipientFromSignedUpUser(user: {
  email: string | null | undefined;
}): string | null {
  const email = user.email?.trim() ?? "";
  if (!email || email.length > 320 || /[\r\n\s]/.test(email)) return null;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) return null;
  return email;
}

export function welcomeIdempotencyKey(userId: string): string {
  return `welcome:user:${userId}`;
}

export async function enqueueTransactionalEmail(
  db: EmailWriter,
  input: {
    userId: string;
    toEmail: string;
    template: EmailOutboxTemplate;
    idempotencyKey: string;
    subject: string;
    html: string;
    text: string;
  },
): Promise<{ enqueued: boolean; reason?: "missing_email" | "duplicate" }> {
  const toEmail = recipientFromSignedUpUser({ email: input.toEmail });
  if (!toEmail) return { enqueued: false, reason: "missing_email" };
  const inserted = await db
    .insert(emailOutbox)
    .values({
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      template: input.template,
      toEmail,
      subject: input.subject,
      html: input.html,
      bodyText: input.text,
      status: "pending",
    })
    .onConflictDoNothing({ target: emailOutbox.idempotencyKey })
    .returning({ id: emailOutbox.id });
  if (!inserted[0]) return { enqueued: false, reason: "duplicate" };
  return { enqueued: true };
}

/** First successful sign-in only. Repeat calls conflict on `welcome:user:<id>`. */
export async function enqueueWelcomeOnce(
  db: EmailWriter,
  user: { id: string; email: string; displayName: string },
  env: EnvMap = process.env,
): Promise<{ enqueued: boolean; reason?: "missing_email" | "duplicate" }> {
  const toEmail = recipientFromSignedUpUser(user);
  if (!toEmail) return { enqueued: false, reason: "missing_email" };
  const content = renderWelcomeEmail({
    displayName: user.displayName,
    baseUrl: readEmailBaseUrl(env),
  });
  return enqueueTransactionalEmail(db, {
    userId: user.id,
    toEmail,
    template: "welcome",
    idempotencyKey: welcomeIdempotencyKey(user.id),
    subject: content.subject,
    html: content.html,
    text: content.text,
  });
}

/**
 * If the Google email changes before a pending welcome is sent, keep the
 * recipient on the signed-up user row. Sent rows are left alone.
 */
export async function syncPendingRecipient(
  db: EmailWriter,
  args: { idempotencyKey: string; toEmail: string },
): Promise<void> {
  const toEmail = recipientFromSignedUpUser({ email: args.toEmail });
  if (!toEmail) return;
  await db
    .update(emailOutbox)
    .set({ toEmail, updatedAt: new Date() })
    .where(and(eq(emailOutbox.idempotencyKey, args.idempotencyKey), eq(emailOutbox.status, "pending")));
}
