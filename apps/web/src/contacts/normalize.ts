import { isGithubNoreplyEmail } from "../email/recipients";
import { MARKETING_CONTACT_SOURCES, type MarketingContactSource } from "../db/schema";

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercase and trim. Blank, malformed, and GitHub noreply addresses are null. */
export function normalizeContactEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  if (!email || !SIMPLE_EMAIL.test(email)) return null;
  if (isGithubNoreplyEmail(email)) return null;
  return email;
}

/** Import rows keep whatever mailbox Ops supplied, including a noreply address. */
export function normalizeImportedEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  if (!email || !SIMPLE_EMAIL.test(email)) return null;
  return email;
}

export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

/** First token is the given name. The rest is the family name. */
export function splitDisplayName(displayName: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = displayName?.trim() ?? "";
  if (!trimmed) return { firstName: null, lastName: null };
  const space = trimmed.indexOf(" ");
  if (space === -1) return { firstName: trimmed, lastName: null };
  return {
    firstName: blankToNull(trimmed.slice(0, space)),
    lastName: blankToNull(trimmed.slice(space + 1)),
  };
}

export function parseContactSource(value: string | null | undefined): MarketingContactSource | null {
  const source = value?.trim().toLowerCase() ?? "";
  if ((MARKETING_CONTACT_SOURCES as readonly string[]).includes(source)) {
    return source as MarketingContactSource;
  }
  return null;
}

/**
 * A person who is already `lb1` and then appears as `ghb` (or the reverse) becomes `both`.
 * `both` stays `both`.
 */
export function mergeContactSource(
  current: MarketingContactSource | null,
  incoming: MarketingContactSource,
): MarketingContactSource {
  if (!current || current === incoming) return incoming;
  if (current === "both" || incoming === "both") return "both";
  return "both";
}
