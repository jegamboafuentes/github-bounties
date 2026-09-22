/**
 * Resend HTTPS API adapter (https://api.resend.com/emails).
 * Fits Cloud Run: no SMTP socket, no client bundle, key stays in process env.
 */

import type { EnvMap } from "../auth/env";
import { readResendApiKey, readResendFrom } from "./env";
import type {
  EmailProviderSendResult,
  OutboundEmail,
  TransactionalEmailProvider,
} from "./provider";

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";
export const RESEND_TIMEOUT_MS = 8_000;

export type ResendHttp = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export function classifyResendStatus(status: number): { error: string; retryable: boolean } {
  if (status === 401 || status === 403) {
    return { error: "provider_auth", retryable: true };
  }
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) {
    return { error: `resend_http_${status}`, retryable: true };
  }
  return { error: `resend_http_${status}`, retryable: false };
}

export function createResendEmailProvider(args: {
  apiKey: string;
  from: string;
  http?: ResendHttp;
  timeoutMs?: number;
}): TransactionalEmailProvider {
  const http = args.http ?? defaultHttp;
  const timeoutMs = args.timeoutMs ?? RESEND_TIMEOUT_MS;
  return {
    name: "resend",
    async send(message: OutboundEmail): Promise<EmailProviderSendResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await http(RESEND_EMAILS_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${args.apiKey}`,
            "content-type": "application/json",
            "idempotency-key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: args.from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
          }),
          signal: controller.signal,
        });
        if (!res.ok) return { ok: false, ...classifyResendStatus(res.status) };
        const body = (await res.json()) as { id?: unknown };
        const providerMessageId = typeof body.id === "string" ? body.id : "";
        if (!providerMessageId) return { ok: false, error: "resend_parse", retryable: true };
        return { ok: true, providerMessageId };
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        return {
          ok: false,
          error: aborted ? "resend_timeout" : "resend_fetch",
          retryable: true,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function resolveEmailProvider(
  env: EnvMap = process.env,
  http?: ResendHttp,
): TransactionalEmailProvider | null {
  const apiKey = readResendApiKey(env);
  const from = readResendFrom(env);
  if (!apiKey || !from) return null;
  return createResendEmailProvider({ apiKey, from, http });
}

function defaultHttp(
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) {
  return fetch(input, init);
}
