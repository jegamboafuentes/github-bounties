/**
 * Resend audience sync for marketing_contacts.
 * Unsubscribes are one-way: a local unsubscribe is pushed as unsubscribed=true,
 * and a subscribed row is never sent back as unsubscribed=false on update.
 * If RESEND_AUDIENCE_ID is unset, every sync path is a no-op.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { EnvMap } from "../auth/env";
import type { Database } from "../db/client";
import { marketingContacts, type MarketingContactSource } from "../db/schema";
import { readResendApiKey } from "../email/env";
import { normalizeImportedEmail } from "./normalize";

export const RESEND_AUDIENCE_ID_ENV = "RESEND_AUDIENCE_ID" as const;
export const RESEND_WEBHOOK_SECRET_ENV = "RESEND_WEBHOOK_SECRET" as const;

const RESEND_API = "https://api.resend.com";
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type ResendHttp = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text?: () => Promise<string> }>;

export type ContactSyncRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  githubUsername: string | null;
  source: MarketingContactSource;
  subscribed: boolean;
  unsubscribedAt: Date | null;
  resendContactId: string | null;
  resendSyncedAt: Date | null;
  updatedAt: Date;
};

export type SyncResult = {
  configured: boolean;
  pushed: number;
  pushFailed: number;
  pullUnsubscribed: number;
};

export function readResendAudienceId(env: EnvMap = process.env): string {
  return env[RESEND_AUDIENCE_ID_ENV]?.trim() ?? "";
}

export function readResendWebhookSecret(env: EnvMap = process.env): string {
  return env[RESEND_WEBHOOK_SECRET_ENV]?.trim() ?? "";
}

export function marketingSyncConfigured(env: EnvMap = process.env): boolean {
  return Boolean(readResendAudienceId(env) && readResendApiKey(env));
}

function webhookKey(secret: string): Buffer | null {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length === 0) return null;
  return key;
}

/** Svix signature used by Resend webhooks. The payload is the raw body. */
export function verifyResendWebhookSignature(input: {
  payload: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  now?: Date;
}): boolean {
  const id = input.id?.trim() ?? "";
  const timestamp = input.timestamp?.trim() ?? "";
  const signature = input.signature?.trim() ?? "";
  const key = webhookKey(input.secret.trim());
  if (!id || !timestamp || !signature || !key) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - seconds) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${input.payload}`).digest();
  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    const actual = Buffer.from(value, "base64");
    if (actual.length !== expected.length) continue;
    if (timingSafeEqual(actual, expected)) return true;
  }
  return false;
}

export type ResendUnsubscribe = {
  email: string;
  resendId: string | null;
  audienceId: string | null;
};

/**
 * contact.updated with unsubscribed=true, and any event whose type is an unsubscribe.
 * A contact.updated that is still subscribed does not re-subscribe anyone.
 */
export function unsubscribeFromResendEvent(body: unknown): ResendUnsubscribe | null {
  if (!body || typeof body !== "object") return null;
  const type = (body as { type?: unknown }).type;
  const data = (body as { data?: unknown }).data;
  if (typeof type !== "string" || !data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const email = typeof record.email === "string" ? normalizeImportedEmail(record.email) : null;
  if (!email) return null;
  const unsubscribed = record.unsubscribed === true;
  const unsubscribeEvent = type === "contact.unsubscribed" || type.endsWith(".unsubscribed") || type.includes("unsubscribe");
  if (type === "contact.updated" && !unsubscribed) return null;
  if (type !== "contact.updated" && !unsubscribeEvent) return null;
  if (!unsubscribed && !unsubscribeEvent) return null;
  return {
    email,
    resendId: typeof record.id === "string" ? record.id : null,
    audienceId: typeof record.audience_id === "string" ? record.audience_id : null,
  };
}

function logSync(event: string, detail: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, ...detail }));
}

async function readError(res: { text?: () => Promise<string>; json: () => Promise<unknown> }): Promise<string> {
  try {
    if (res.text) return (await res.text()).slice(0, 300);
  } catch {
    // fall through
  }
  try {
    return JSON.stringify(await res.json()).slice(0, 300);
  } catch {
    return "provider_error";
  }
}

function contactPayload(row: ContactSyncRow, includeUnsubscribed: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (row.firstName) body.first_name = row.firstName;
  if (row.lastName) body.last_name = row.lastName;
  if (includeUnsubscribed) body.unsubscribed = !row.subscribed;
  return body;
}

async function addToAudience(http: ResendHttp, apiKey: string, email: string, audienceId: string): Promise<boolean> {
  const res = await http(`${RESEND_API}/contacts/${encodeURIComponent(email)}/segments/${audienceId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: "{}",
  });
  return res.ok || res.status === 409;
}

/**
 * Create or update one contact. Updates never send unsubscribed=false.
 * Returns the Resend contact id when the call succeeded.
 */
export async function pushContactToResend(
  row: ContactSyncRow,
  env: EnvMap,
  http: ResendHttp,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const audienceId = readResendAudienceId(env);
  const apiKey = readResendApiKey(env);
  if (!audienceId || !apiKey) return { ok: true, id: null };
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  try {
    let id = row.resendContactId;
    if (!id) {
      const created = await http(`${RESEND_API}/contacts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: row.email,
          ...contactPayload(row, true),
          segments: [{ id: audienceId }],
        }),
      });
      if (created.ok) {
        const body = (await created.json()) as { id?: unknown };
        id = typeof body.id === "string" ? body.id : null;
      } else if (created.status !== 409 && created.status !== 422) {
        return { ok: false, error: `resend_http_${created.status}: ${await readError(created)}` };
      }
    }
    const patch = contactPayload(row, !row.subscribed);
    if (Object.keys(patch).length > 0) {
      const updated = await http(`${RESEND_API}/contacts/${encodeURIComponent(id || row.email)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(patch),
      });
      if (!updated.ok && updated.status !== 409) {
        return { ok: false, error: `resend_http_${updated.status}: ${await readError(updated)}` };
      }
      if (!id) {
        try {
          const body = (await updated.json()) as { id?: unknown };
          if (typeof body.id === "string") id = body.id;
        } catch {
          id = null;
        }
      }
    }
    const added = await addToAudience(http, apiKey, row.email, audienceId);
    if (!added) return { ok: false, error: "resend_segment_add_failed" };
    return { ok: true, id: id ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "resend_fetch_failed" };
  }
}

export async function pushContactBestEffort(
  db: Database,
  row: ContactSyncRow,
  opts: { env?: EnvMap; http?: ResendHttp } = {},
): Promise<void> {
  const env = opts.env ?? process.env;
  if (!marketingSyncConfigured(env)) return;
  const http = opts.http ?? fetch;
  try {
    const pushed = await pushContactToResend(row, env, http);
    if (!pushed.ok) {
      logSync("marketing_contact_push_failed", { contactId: row.id, error: pushed.error });
      return;
    }
    const syncedAt = new Date();
    await db
      .update(marketingContacts)
      .set({
        resendContactId: pushed.id ?? row.resendContactId,
        resendSyncedAt: syncedAt,
        updatedAt: row.updatedAt,
      })
      .where(and(eq(marketingContacts.id, row.id), eq(marketingContacts.updatedAt, row.updatedAt)));
  } catch (err) {
    logSync("marketing_contact_push_failed", {
      contactId: row.id,
      error: err instanceof Error ? err.message : "push_failed",
    });
  }
}

type RemoteContact = { id?: string; email?: string; unsubscribed?: boolean };

async function listAudience(http: ResendHttp, apiKey: string, audienceId: string): Promise<RemoteContact[]> {
  const found: RemoteContact[] = [];
  let after = "";
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${RESEND_API}/segments/${audienceId}/contacts`);
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const res = await http(url.toString(), { headers: { authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`resend_http_${res.status}`);
    const body = (await res.json()) as { data?: RemoteContact[]; has_more?: boolean };
    const data = Array.isArray(body.data) ? body.data : [];
    found.push(...data);
    const last = data[data.length - 1]?.id;
    if (!body.has_more || !last || last === after) break;
    after = last;
  }
  return found;
}

/** Mark a local row unsubscribed. Already-unsubscribed rows stay as they are. Unknown emails are ignored. */
export async function markContactUnsubscribed(
  db: Database,
  email: string,
  now: Date,
  resendId: string | null = null,
): Promise<boolean> {
  const normalized = normalizeImportedEmail(email);
  if (!normalized) return false;
  const [existing] = await db
    .select()
    .from(marketingContacts)
    .where(eq(marketingContacts.email, normalized))
    .limit(1);
  if (!existing || !existing.subscribed) {
    if (existing && resendId && !existing.resendContactId) {
      await db
        .update(marketingContacts)
        .set({ resendContactId: resendId, updatedAt: existing.updatedAt })
        .where(eq(marketingContacts.id, existing.id));
    }
    return false;
  }
  await db
    .update(marketingContacts)
    .set({
      subscribed: false,
      unsubscribedAt: existing.unsubscribedAt ?? now,
      resendContactId: resendId ?? existing.resendContactId,
      updatedAt: now,
    })
    .where(eq(marketingContacts.id, existing.id));
  return true;
}

export async function applyResendUnsubscribe(
  db: Database,
  event: ResendUnsubscribe | null,
  opts: { audienceId: string; now?: Date },
): Promise<boolean> {
  if (!event) return false;
  if (!opts.audienceId) return false;
  if (event.audienceId && event.audienceId !== opts.audienceId) return false;
  return markContactUnsubscribed(db, event.email, opts.now ?? new Date(), event.resendId);
}

export async function syncMarketingContacts(
  db: Database,
  opts: { env?: EnvMap; http?: ResendHttp; now?: Date; limit?: number } = {},
): Promise<SyncResult> {
  const env = opts.env ?? process.env;
  const empty: SyncResult = { configured: false, pushed: 0, pushFailed: 0, pullUnsubscribed: 0 };
  if (!marketingSyncConfigured(env)) return empty;
  const http = opts.http ?? fetch;
  const now = opts.now ?? new Date();
  const audienceId = readResendAudienceId(env);
  const apiKey = readResendApiKey(env);
  let pullUnsubscribed = 0;
  try {
    const remote = await listAudience(http, apiKey, audienceId);
    for (const contact of remote) {
      if (contact.unsubscribed !== true || typeof contact.email !== "string") continue;
      const changed = await markContactUnsubscribed(db, contact.email, now, contact.id ?? null);
      if (changed) pullUnsubscribed += 1;
    }
  } catch (err) {
    logSync("marketing_contact_pull_failed", { error: err instanceof Error ? err.message : "pull_failed" });
  }
  const stale = await db
    .select()
    .from(marketingContacts)
    .where(or(isNull(marketingContacts.resendSyncedAt), lt(marketingContacts.resendSyncedAt, marketingContacts.updatedAt)))
    .limit(opts.limit ?? 100);
  let pushed = 0;
  let pushFailed = 0;
  for (const row of stale) {
    const result = await pushContactToResend(row, env, http);
    if (!result.ok) {
      pushFailed += 1;
      logSync("marketing_contact_push_failed", { contactId: row.id, error: result.error });
      continue;
    }
    const syncedAt = new Date();
    await db
      .update(marketingContacts)
      .set({
        resendContactId: result.id ?? row.resendContactId,
        resendSyncedAt: syncedAt,
        updatedAt: row.updatedAt,
      })
      .where(and(eq(marketingContacts.id, row.id), eq(marketingContacts.updatedAt, row.updatedAt)));
    pushed += 1;
  }
  return { configured: true, pushed, pushFailed, pullUnsubscribed };
}

export type WebhookHandleResult = {
  status: number;
  body: { ok: boolean; error?: string; configured?: boolean; unsubscribed?: boolean };
};

export async function handleResendWebhook(
  input: {
    payload: string;
    id: string | null;
    timestamp: string | null;
    signature: string | null;
    env?: EnvMap;
    db: Database;
    now?: Date;
  },
): Promise<WebhookHandleResult> {
  const env = input.env ?? process.env;
  const secret = readResendWebhookSecret(env);
  if (!secret) return { status: 401, body: { ok: false, error: "unauthorized" } };
  const verified = verifyResendWebhookSignature({
    payload: input.payload,
    id: input.id,
    timestamp: input.timestamp,
    signature: input.signature,
    secret,
    now: input.now,
  });
  if (!verified) return { status: 401, body: { ok: false, error: "unauthorized" } };
  const audienceId = readResendAudienceId(env);
  if (!audienceId) return { status: 200, body: { ok: true, configured: false } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.payload) as unknown;
  } catch {
    return { status: 400, body: { ok: false, error: "invalid_json" } };
  }
  const event = unsubscribeFromResendEvent(parsed);
  const unsubscribed = await applyResendUnsubscribe(input.db, event, { audienceId, now: input.now });
  return { status: 200, body: { ok: true, configured: true, unsubscribed } };
}

export function cronUnauthorized(request: Request, env: EnvMap = process.env): Response | null {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) return null;
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}
