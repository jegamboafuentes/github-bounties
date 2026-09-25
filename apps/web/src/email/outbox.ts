/**
 * Durable email outbox. Claim uses FOR UPDATE SKIP LOCKED so two workers
 * cannot own the same row. markSent only succeeds for the worker that claimed
 * it. A sent row is never claimed again.
 *
 * Recipients are loaded from `users.email` (Google signup). Callers cannot
 * pass a scraped GitHub address.
 */

import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import type { EnvMap } from "../auth/env";
import type { Database } from "../db/client";
import { getRuntimeDb } from "../db/runtime";
import {
  emailOutbox,
  EMAIL_TEMPLATE_VALUES,
  users,
  type EmailOutboxPayload,
  type EmailTemplateName,
} from "../db/schema";
import { isEmailTemplateEnabled } from "../profile/settings";
import { createResendAdapter, type TransactionalEmailAdapter } from "./adapter";
import { hasResendApiKey, readEmailOrigin } from "./env";
import { normalizeSignupEmail } from "./recipients";
import { renderEmail } from "./templates";

export const EMAIL_MAX_ATTEMPTS = 5;
export const EMAIL_CLAIM_LEASE_SECONDS = 5 * 60;

type EmailOutboxRow = typeof emailOutbox.$inferSelect;

export type EnqueueEmailResult =
  | { ok: true; id: string; created: boolean; idempotencyKey: string }
  | {
      ok: false;
      reason: "missing_user" | "missing_email" | "rejected_recipient" | "invalid_template" | "preference_disabled";
    };

export type DeliverOutboxResult = {
  configured: boolean;
  reason?: "missing_secret";
  claimed: number;
  sent: number;
  retryable: number;
  failed: number;
};

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 5;
  return Math.min(20, Math.max(1, Math.floor(limit ?? 5)));
}

function isTemplate(value: string): value is EmailTemplateName {
  return (EMAIL_TEMPLATE_VALUES as readonly string[]).includes(value);
}

function payloadOf(value: EmailOutboxPayload | null | undefined): EmailOutboxPayload {
  if (!value || typeof value !== "object") return {};
  const payload: EmailOutboxPayload = {};
  if (typeof value.displayName === "string") payload.displayName = value.displayName;
  if (typeof value.bountyTitle === "string") payload.bountyTitle = value.bountyTitle;
  if (typeof value.bountyUrl === "string") payload.bountyUrl = value.bountyUrl;
  if (typeof value.amountLabel === "string") payload.amountLabel = value.amountLabel;
  if (typeof value.repoFullName === "string") payload.repoFullName = value.repoFullName;
  if (typeof value.issueNumber === "number") payload.issueNumber = value.issueNumber;
  return payload;
}

/**
 * Insert one outbox row for a signed-up user. `to` is `users.email` only.
 * Repeat idempotency keys do not insert a second row.
 */
export async function enqueueEmailForUser(
  input: {
    userId: string;
    template: EmailTemplateName;
    idempotencyKey: string;
    payload?: EmailOutboxPayload;
  },
  db: Database = getRuntimeDb(),
): Promise<EnqueueEmailResult> {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!input.userId || !idempotencyKey) {
    return { ok: false, reason: "missing_user" };
  }
  if (!isTemplate(input.template)) {
    return { ok: false, reason: "invalid_template" };
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!user) return { ok: false, reason: "missing_user" };

  if (!(await isEmailTemplateEnabled(db, user.id, input.template))) {
    return { ok: false, reason: "preference_disabled" };
  }

  const toEmail = normalizeSignupEmail(user.email);
  if (!toEmail) {
    const blank = !user.email?.trim();
    return { ok: false, reason: blank ? "missing_email" : "rejected_recipient" };
  }

  const payload = payloadOf({
    displayName: user.displayName,
    ...input.payload,
  });

  const [inserted] = await db
    .insert(emailOutbox)
    .values({
      idempotencyKey,
      userId: user.id,
      toEmail,
      template: input.template,
      payload,
      status: "pending",
    })
    .onConflictDoNothing({ target: emailOutbox.idempotencyKey })
    .returning({ id: emailOutbox.id });

  if (inserted) {
    return { ok: true, id: inserted.id, created: true, idempotencyKey };
  }

  const [existing] = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(eq(emailOutbox.idempotencyKey, idempotencyKey))
    .limit(1);
  if (!existing) {
    return { ok: false, reason: "missing_user" };
  }
  return { ok: true, id: existing.id, created: false, idempotencyKey };
}

/**
 * Move pending (or lease-expired sending) rows to `sending`.
 * Concurrent callers skip locked rows.
 */
export async function claimEmailOutbox(args: {
  db?: Database;
  workerId?: string;
  limit?: number;
  userId?: string;
  leaseSeconds?: number;
}): Promise<EmailOutboxRow[]> {
  const db = args.db ?? getRuntimeDb();
  const workerId = args.workerId?.trim() || randomUUID();
  const limit = clampLimit(args.limit);
  const leaseSeconds = args.leaseSeconds ?? EMAIL_CLAIM_LEASE_SECONDS;
  const userFilter = args.userId ? sql`and user_id = ${args.userId}::uuid` : sql``;

  const result = await db.execute(sql`
    with picked as (
      select id
      from email_outbox
      where (
        status = 'pending'
        or (
          status = 'sending'
          and claimed_at is not null
          and claimed_at < now() - make_interval(secs => ${leaseSeconds})
        )
      )
      ${userFilter}
      order by created_at
      for update skip locked
      limit ${limit}
    )
    update email_outbox as o
    set
      status = 'sending',
      attempt_count = o.attempt_count + 1,
      claimed_at = now(),
      claimed_by = ${workerId},
      updated_at = now()
    from picked
    where o.id = picked.id
    returning o.id
  `);

  const ids = rowsOf<{ id: string }>(result)
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return [];
  return db.select().from(emailOutbox).where(inArray(emailOutbox.id, ids));
}

async function markEmailSent(
  db: Database,
  id: string,
  workerId: string,
  providerMessageId: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    update email_outbox
    set
      status = 'sent',
      sent_at = now(),
      provider_message_id = ${providerMessageId},
      last_error = null,
      updated_at = now()
    where id = ${id}::uuid
      and status = 'sending'
      and claimed_by = ${workerId}
    returning id
  `);
  return rowsOf(result).length > 0;
}

async function markEmailAttemptFailed(
  db: Database,
  id: string,
  workerId: string,
  error: string,
  maxAttempts: number,
): Promise<"pending" | "failed" | "lost"> {
  const clipped = error.trim().slice(0, 500) || "provider_error";
  const result = await db.execute(sql`
    update email_outbox
    set
      status = case when attempt_count >= ${maxAttempts} then 'failed' else 'pending' end,
      last_error = ${clipped},
      claimed_at = null,
      claimed_by = null,
      updated_at = now()
    where id = ${id}::uuid
      and status = 'sending'
      and claimed_by = ${workerId}
    returning status
  `);
  const row = rowsOf<{ status: string }>(result)[0];
  if (!row) return "lost";
  return row.status === "failed" ? "failed" : "pending";
}

async function markEmailTerminal(
  db: Database,
  id: string,
  workerId: string,
  error: string,
): Promise<void> {
  const clipped = error.trim().slice(0, 500) || "failed";
  await db.execute(sql`
    update email_outbox
    set
      status = 'failed',
      last_error = ${clipped},
      claimed_at = null,
      claimed_by = null,
      updated_at = now()
    where id = ${id}::uuid
      and status = 'sending'
      and claimed_by = ${workerId}
  `);
}

async function releaseClaim(
  db: Database,
  id: string,
  workerId: string,
  error: string,
): Promise<void> {
  await db.execute(sql`
    update email_outbox
    set
      status = 'pending',
      attempt_count = greatest(attempt_count - 1, 0),
      last_error = ${error.slice(0, 500)},
      claimed_at = null,
      claimed_by = null,
      updated_at = now()
    where id = ${id}::uuid
      and status = 'sending'
      and claimed_by = ${workerId}
  `);
}

/**
 * Claim and send. When the provider secret is missing and no adapter is
 * injected, rows stay pending and this returns without throwing.
 */
export async function deliverOutbox(args: {
  db?: Database;
  env?: EnvMap;
  adapter?: TransactionalEmailAdapter;
  userId?: string;
  limit?: number;
  workerId?: string;
  maxAttempts?: number;
} = {}): Promise<DeliverOutboxResult> {
  const env = args.env ?? process.env;
  const db = args.db ?? getRuntimeDb();
  const maxAttempts = args.maxAttempts ?? EMAIL_MAX_ATTEMPTS;
  if (!args.adapter && !hasResendApiKey(env)) {
    return {
      configured: false,
      reason: "missing_secret",
      claimed: 0,
      sent: 0,
      retryable: 0,
      failed: 0,
    };
  }

  const workerId = args.workerId?.trim() || randomUUID();
  const adapter = args.adapter ?? createResendAdapter({ env });
  const claimedRows = await claimEmailOutbox({
    db,
    workerId,
    limit: args.limit,
    userId: args.userId,
  });

  const summary: DeliverOutboxResult = {
    configured: true,
    claimed: claimedRows.length,
    sent: 0,
    retryable: 0,
    failed: 0,
  };

  for (const row of claimedRows) {
    try {
      const [user] = await db
        .select({ email: users.email, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, row.userId))
        .limit(1);
      const toEmail = normalizeSignupEmail(user?.email);
      if (!toEmail) {
        await markEmailTerminal(db, row.id, workerId, user ? "rejected_recipient" : "missing_email");
        summary.failed += 1;
        continue;
      }

      if (!isTemplate(row.template)) {
        await markEmailTerminal(db, row.id, workerId, "invalid_template");
        summary.failed += 1;
        continue;
      }

      if (user && !(await isEmailTemplateEnabled(db, row.userId, row.template))) {
        await markEmailTerminal(db, row.id, workerId, "notification_preference_disabled");
        summary.failed += 1;
        continue;
      }

      if (toEmail !== row.toEmail) {
        await db
          .update(emailOutbox)
          .set({ toEmail, updatedAt: new Date() })
          .where(eq(emailOutbox.id, row.id));
      }

      const rendered = renderEmail(row.template, {
        displayName: user?.displayName || row.payload?.displayName || "there",
        origin: readEmailOrigin(env),
        payload: row.payload,
      });
      const sent = await adapter.send({
        to: toEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: row.idempotencyKey,
      });

      if (sent.ok) {
        const marked = await markEmailSent(db, row.id, workerId, sent.providerMessageId);
        if (marked) summary.sent += 1;
        else summary.failed += 1;
        continue;
      }

      if (sent.reason === "missing_secret") {
        await releaseClaim(db, row.id, workerId, "missing_secret");
        summary.reason = "missing_secret";
        continue;
      }

      const next = await markEmailAttemptFailed(
        db,
        row.id,
        workerId,
        sent.error || sent.reason,
        maxAttempts,
      );
      if (next === "failed") summary.failed += 1;
      else summary.retryable += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "deliver_failed";
      const next = await markEmailAttemptFailed(db, row.id, workerId, message, maxAttempts);
      if (next === "failed") summary.failed += 1;
      else summary.retryable += 1;
    }
  }

  return summary;
}
