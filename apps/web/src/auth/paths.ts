/** Protected surface. Public: /, /about, /roadmap, /mcp (setup page + protocol), /signin, /board, /bounties/[id], /api/health, /api/stats, /api/v1/*, /api/docs, /api/auth/*, POST /webhooks/github, POST /webhooks/huggingface. /developers is a 308 to /mcp. Hugging Face connect is session-gated and is not product login. */

export const PROTECTED_PAGE_PREFIXES = [
  "/settings",
  "/github/setup",
  "/github/callback",
  "/huggingface/callback",
  "/bounties/new",
] as const;
export const PROTECTED_API_PREFIXES = [
  "/api/me",
  "/api/github/connect",
  "/api/huggingface/connect",
  "/api/huggingface/disconnect",
] as const;

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
