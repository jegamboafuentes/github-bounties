/**
 * Resend transactional adapter. Server-side fetch only — no SDK, no client bundle.
 * Soft-fails when RESEND_API_KEY is unset. Never reads NEXT_PUBLIC_*.
 */

import type { EnvMap } from "../auth/env";
import { hasResendApiKey, readEmailFrom, readResendApiKey } from "./env";

export type EmailSendRequest = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export type EmailSendResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      reason: "missing_secret" | "provider_error" | "invalid_recipient";
      error?: string;
    };

export type TransactionalEmailAdapter = {
  send(message: EmailSendRequest): Promise<EmailSendResult>;
};

export type ResendHttp = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

const RESEND_URL = "https://api.resend.com/emails";

function clip(value: string, max = 300): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

async function readError(res: { text?: () => Promise<string>; json: () => Promise<unknown> }): Promise<string> {
  try {
    if (res.text) {
      const body = await res.text();
      return clip(body || "provider_error");
    }
  } catch {
    // fall through
  }
  try {
    const body = await res.json();
    return clip(typeof body === "string" ? body : JSON.stringify(body));
  } catch {
    return "provider_error";
  }
}

export function createResendAdapter(args: { env?: EnvMap; http?: ResendHttp } = {}): TransactionalEmailAdapter {
  const env = args.env ?? process.env;
  const http = args.http ?? fetch;

  return {
    async send(message) {
      const apiKey = readResendApiKey(env);
      if (!apiKey || !hasResendApiKey(env)) {
        return { ok: false, reason: "missing_secret" };
      }
      const to = message.to.trim();
      if (!to) {
        return { ok: false, reason: "invalid_recipient", error: "missing_email" };
      }

      let res: Awaited<ReturnType<ResendHttp>>;
      try {
        res = await http(RESEND_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "idempotency-key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: readEmailFrom(env),
            to: [to],
            subject: message.subject,
            html: message.html,
            text: message.text,
          }),
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : "provider_fetch_failed";
        return { ok: false, reason: "provider_error", error: clip(error) };
      }

      if (!res.ok) {
        const error = await readError(res);
        return { ok: false, reason: "provider_error", error: `resend_http_${res.status}: ${error}` };
      }

      let providerMessageId = "";
      try {
        const body = (await res.json()) as { id?: unknown };
        if (typeof body?.id === "string") providerMessageId = body.id;
      } catch {
        providerMessageId = "";
      }
      if (!providerMessageId) {
        return { ok: false, reason: "provider_error", error: "resend_missing_id" };
      }
      return { ok: true, providerMessageId };
    },
  };
}
