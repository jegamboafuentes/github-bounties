/**
 * Recipients come from the signed-up user row (`users.email`, Google auth).
 * GitHub noreply addresses are not a signup mailbox — including ones that
 * appear on a public profile or a scraped payload.
 */

const GITHUB_NOREPLY = /@(?:users\.)?noreply\.github\.com$/i;
const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isGithubNoreplyEmail(email: string): boolean {
  return GITHUB_NOREPLY.test(email.trim().toLowerCase());
}

/**
 * Signup mailbox we will actually send to.
 * Blank, malformed, and GitHub noreply addresses return null.
 */
export function normalizeSignupEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim() ?? "";
  if (!trimmed || !SIMPLE_EMAIL.test(trimmed)) return null;
  if (isGithubNoreplyEmail(trimmed)) return null;
  return trimmed;
}
