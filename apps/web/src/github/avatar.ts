/**
 * GitHub profile avatar from a linked login.
 * Uses avatars.githubusercontent.com — no extra CDN, no schema field required.
 */
export function githubAvatarUrl(login?: string | null, size = 64): string | null {
  const trimmed = login?.trim();
  if (!trimmed) return null;
  return `https://avatars.githubusercontent.com/${encodeURIComponent(trimmed)}?s=${size}`;
}

export function githubProfileUrl(login?: string | null): string | null {
  const trimmed = login?.trim();
  if (!trimmed) return null;
  return `https://github.com/${encodeURIComponent(trimmed)}`;
}
