/**
 * Transactional email env. Server-only.
 *
 * Secret Manager key RESEND_API_KEY (optional, DEV). Never NEXT_PUBLIC_*.
 * RESEND_FROM is a plain from-address, not a secret. Both must be set to send.
 * Missing values are non-fatal: sign-in still persists the user and the outbox
 * row stays pending until a later dispatch.
 */

import type { EnvMap } from "../auth/env";
import { DEV_SITE_HOST, PROD_CLOUD_RUN_SERVICE, PROD_SITE_HOST } from "../lib/site-env";

export const RESEND_API_KEY_ENV = "RESEND_API_KEY" as const;
export const RESEND_FROM_ENV = "RESEND_FROM" as const;

/** Used when PUBLIC_BASE_URL and AUTH_URL are unset. This slice is DEV-only. */
export const DEV_EMAIL_BASE_URL = `https://${DEV_SITE_HOST}`;

export function readResendApiKey(env: EnvMap = process.env): string {
  return env[RESEND_API_KEY_ENV]?.trim() ?? "";
}

export function readResendFrom(env: EnvMap = process.env): string {
  const raw = env[RESEND_FROM_ENV]?.trim() ?? "";
  if (!raw || /[\r\n]/.test(raw) || !raw.includes("@")) return "";
  return raw;
}

export function emailNotConfiguredReason(
  env: EnvMap = process.env,
): "missing_secret" | "missing_from" | null {
  if (!readResendApiKey(env)) return "missing_secret";
  if (!readResendFrom(env)) return "missing_from";
  return null;
}

/** Health probe. True only when a send could be attempted. Never returns the key. */
export function emailHealth(env: EnvMap = process.env): { configured: boolean } {
  return { configured: emailNotConfiguredReason(env) === null };
}

function isProdOrigin(value: string | null | undefined): boolean {
  const origin = normalizeHttpBaseUrl(value);
  if (!origin) return false;
  const host = new URL(origin).hostname.toLowerCase();
  return host === PROD_SITE_HOST || host === `www.${PROD_SITE_HOST}`;
}

/**
 * Welcome enqueue and dispatch run locally and on DEV.
 * They stay off on the prod Cloud Run service, `APP_ENV=prod`, or the apex host
 * so a main revision cannot send from PROD even if a key is present.
 */
export function transactionalEmailEnabled(env: EnvMap = process.env): boolean {
  if ((env.K_SERVICE ?? "").trim() === PROD_CLOUD_RUN_SERVICE) return false;
  const appEnv = (env.APP_ENV ?? env.GB_ENV ?? "").trim().toLowerCase();
  if (appEnv === "prod" || appEnv === "production") return false;
  if (isProdOrigin(env.PUBLIC_BASE_URL) || isProdOrigin(env.AUTH_URL)) return false;
  return true;
}

export function normalizeHttpBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Absolute origin for links and the logo in email HTML.
 * PUBLIC_BASE_URL, then AUTH_URL, then the DEV site. Unset env does not point at PROD.
 */
export function readEmailBaseUrl(env: EnvMap = process.env): string {
  return (
    normalizeHttpBaseUrl(env.PUBLIC_BASE_URL) ??
    normalizeHttpBaseUrl(env.AUTH_URL) ??
    DEV_EMAIL_BASE_URL
  );
}
