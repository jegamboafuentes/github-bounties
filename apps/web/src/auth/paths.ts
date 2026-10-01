/** Protected surface. Public: /, /about, /roadmap, /mcp (setup page + protocol), /signin, /board, /bounties/[id], /api/health, /api/stats, /api/v1/*, /api/docs, /api/auth/*, POST /webhooks/github. /developers is a 308 to /mcp. */

export const PROTECTED_PAGE_PREFIXES = [
  "/settings",
  "/github/setup",
  "/github/callback",
  "/bounties/new",
] as const;
export const PROTECTED_API_PREFIXES = ["/api/me", "/api/github/connect"] as const;

export function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPagePath(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix));
}

export function isProtectedApiPath(pathname: string): boolean {
  return PROTECTED_API_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix));
}

export function isProtectedPath(pathname: string): boolean {
  return isProtectedPagePath(pathname) || isProtectedApiPath(pathname);
}
