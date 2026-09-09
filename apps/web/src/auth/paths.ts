/** Minimal protected surface for V1-2. Public: /, /signin, /api/health, /api/auth/*, GitHub App stubs. */

export const PROTECTED_PAGE_PREFIXES = ["/settings"] as const;
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
