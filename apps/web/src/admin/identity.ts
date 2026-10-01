import type { EnvMap } from "../auth/env";

export type AdminIdentity = {
  email?: string | null;
  /** Google subject stored on the user row. */
  googleSub?: string | null;
  /** Google subject on the current session, when this check is session-backed. */
  sessionGoogleSub?: string | null;
};

/** Comma-separated allow-list. Unset or blank means nobody is an admin. */
export function parseAdminEmails(raw: string | null | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  const emails = new Set<string>();
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (email) emails.add(email);
  }
  return emails;
}

/**
 * Email must be on ADMIN_EMAILS (case-insensitive).
 * When both the user row and the session carry a Google subject, they must match.
 */
export function isAdminIdentity(actor: AdminIdentity, env: EnvMap = process.env): boolean {
  const email = actor.email?.trim().toLowerCase() ?? "";
  if (!email || !parseAdminEmails(env.ADMIN_EMAILS).has(email)) return false;
  const stored = actor.googleSub?.trim() ?? "";
  const session = actor.sessionGoogleSub?.trim() ?? "";
  if (stored && session && stored !== session) return false;
  return true;
}
