/**
 * Outbox dispatcher. Claim is one statement (`FOR UPDATE SKIP LOCKED`) so two
 * workers cannot take the same row. The provider call uses the row's idempotency
 * key, so a crash after accept but before `sent` does not double-send at Resend.
 * The recipient is `email_outbox.to_email`, copied from the signed-up user.
 */

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { EnvMap } from "../auth/env";
import type { Database } from "../db/client";
import { emailOutbox } from "../db/schema";
import { emailNotConfiguredReason, transactionalEmailEnabled } from "./env";
import { recipientFromSignedUpUser } from "./outbox";
import type { TransactionalEmailProvider } from "./provider";
import { resolveEmailProvider } from "./resend";

export const EMAIL_OUTBOX_MAX_ATTEMPTS = 8;
export const EMAIL_OUTBOX_LEASE_MS = 2 * 60 * 1000;

export type DispatchEmailOutboxResult = {
  configured: boolean;
  reason?: "missing_secret" | "missing_from" | "prod_disabled";
  claimed: number;
  sent: number;
  failed: number;
  deferred: number;
};

type ClaimedEmail = {
  id: string;
  idempotencyKey: string;
  toEmail: string;
  subject: string;
  html: string;
  bodyText: string;
  attemptCount: number;
};

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

function asCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function dispatchEmailOutbox(
  opts: {
    db?: Database;
    env?: EnvMap;
    provider?: TransactionalEmailProvider;
    limit?: number;
    workerId?: string;
    leaseMs?: number;
    userId?: string;
    now?: Date;
  } = {},
): Promise<DispatchEmailOutboxResult> {
  const env = opts.env ?? process.env;
  if (!transactionalEmailEnabled(env)) {
    return { configured: false, reason: "prod_disabled", claimed: 0, sent: 0, failed: 0, deferred: 0 };
  }
  const provider = opts.provider ?? resolveEmailProvider(env);
  if (!provider) {
    const reason = emailNotConfiguredReason(env) ?? "missing_secret";
    return { configured: false, reason, claimed: 0, sent: 0, failed: 0, deferred: 0 };
  }
  if (!opts.db) {
    const { getRuntimeDb } = await import("../db/runtime");
    return dispatchEmailOutbox({ ...opts, db: getRuntimeDb(), provider, env });
  }

  const db = opts.db;
  const now = opts.now ?? new Date();
  const leaseMs = opts.leaseMs ?? EMAIL_OUTBOX_LEASE_MS;
  const leaseBefore = new Date(now.getTime() - leaseMs).toISOString();
  const nowIso = now.toISOString();
  const limit = Math.min(50, Math.max(1, Math.floor(opts.limit ?? 10)));
  const workerId = opts.workerId ?? `dispatch:${randomUUID()}`;
  const userFilter = opts.userId ? sql`and user_id = ${opts.userId}::uuid` : sql``;

  const claimed = rowsOf<ClaimedEmail>(
    await db.execute(sql`
      with picked as (
        select id
        from email_outbox
        where (
          status = 'pending'
          or (
            status = 'sending'
            and locked_at is not null
            and locked_at < ${leaseBefore}::timestamptz
          )
        )
        ${userFilter}
        order by created_at asc
        limit ${limit}
        for update skip locked
      )
      update email_outbox as o
      set
        status = 'sending',
        locked_at = ${nowIso}::timestamptz,
        locked_by = ${workerId},
        attempt_count = o.attempt_count + 1,
        updated_at = ${nowIso}::timestamptz
      from picked
      where o.id = picked.id
      returning
        o.id::text as id,
        o.idempotency_key as "idempotencyKey",
        o.to_email as "toEmail",
        o.subject,
        o.html,
        o.body_text as "bodyText",
        o.attempt_count as "attemptCount"
    `),
  ).map((row) => ({ ...row, attemptCount: asCount(row.attemptCount) }));

  let sent = 0;
  let failed = 0;
  let deferred = 0;

  for (const row of claimed) {
    const toEmail = recipientFromSignedUpUser({ email: row.toEmail });
    if (!toEmail) {
      await settle(db, row.id, workerId, {
        status: "failed",
        lastError: "missing_email",
      });
      failed += 1;
      continue;
    }

    let result: Awaited<ReturnType<TransactionalEmailProvider["send"]>>;
    try {
      result = await provider.send({
        to: toEmail,
        subject: row.subject,
        html: row.html,
        text: row.bodyText,
        idempotencyKey: row.idempotencyKey,
      });
    } catch {
      result = { ok: false, error: "provider_throw", retryable: true };
    }

    if (result.ok) {
      await settle(db, row.id, workerId, {
        status: "sent",
        provider: provider.name,
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
        lastError: null,
      });
      sent += 1;
      continue;
    }

    const authFailure = result.error === "provider_auth";
    const terminal =
      !result.retryable || (!authFailure && row.attemptCount >= EMAIL_OUTBOX_MAX_ATTEMPTS);
    await settle(db, row.id, workerId, {
      status: terminal ? "failed" : "pending",
      lastError: result.error.slice(0, 500),
    });
    if (terminal) failed += 1;
    else deferred += 1;
  }

  return { configured: true, claimed: claimed.length, sent, failed, deferred };
}

async function settle(
  db: Database,
  id: string,
  workerId: string,
  patch: {
    status: "sent" | "pending" | "failed";
    lastError: string | null;
    provider?: string;
    providerMessageId?: string;
    sentAt?: Date;
  },
): Promise<void> {
  await db
    .update(emailOutbox)
    .set({
      status: patch.status,
      lastError: patch.lastError,
      provider: patch.provider,
      providerMessageId: patch.providerMessageId,
      sentAt: patch.sentAt,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emailOutbox.id, id),
        eq(emailOutbox.status, "sending"),
        eq(emailOutbox.lockedBy, workerId),
      ),
    );
}
