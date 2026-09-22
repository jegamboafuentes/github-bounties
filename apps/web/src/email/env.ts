/**
 * Transactional email env (V3.x A1). Server-side only.
 *
 * Secret Manager key RESEND_API_KEY on experiment-jegf. Never NEXT_PUBLIC_*.
 * Missing key is a soft degrade — sign-in still succeeds.
 * EMAIL_FROM is plain env (not a secret). PROD is not wired.
 */

import type { EnvMap } from "../auth/env";

export const RESEND_API_KEY_ENV = "RESEND_API_KEY" as const;
export const EMAIL_FROM_ENV = "EMAIL_FROM" as const;

/** Used only when EMAIL_FROM is unset. Domain must be verified at the provider. */
export const DEFAULT_EMAIL_FROM = "GitHub Bounties <noreply@githubbounties.xyz>";

export function readResendApiKey(env: EnvMap = process.env): string {
  return env[RESEND_API_KEY_ENV]?.trim() ?? "";
}

export function hasResendApiKey(env: EnvMap = process.env): boolean {
  return Boolean(readResendApiKey(env));
}

export function readEmailFrom(env: EnvMap = process.env): string {
  return env[EMAIL_FROM_ENV]?.trim() || DEFAULT_EMAIL_FROM;
}

/** Health probe: whether RESEND_API_KEY is set. Never returns the key. */
export function emailHealth(env: EnvMap = process.env): { configured: boolean } {
  return { configured: hasResendApiKey(env) };
}

/**
 * Absolute origin for logo and links in email HTML.
 * PUBLIC_BASE_URL, then AUTH_URL, then the DEV site. Never a secret.
 */
export function readEmailOrigin(env: EnvMap = process.env): string {
  const raw = env.PUBLIC_BASE_URL?.trim() || env.AUTH_URL?.trim() || "";
  if (raw) {
    try {
      const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.origin;
      }
    } catch {
      // fall through to the DEV origin
    }
  }
  return "https://dev.githubbounties.xyz";
}
