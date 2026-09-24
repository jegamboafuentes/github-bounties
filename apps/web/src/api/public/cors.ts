/** Browser GET of `/api/v1` from any origin. No cookies, no credentials. */
export const PUBLIC_API_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function isPublicV1Path(pathname: string): boolean {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}

/** Paths the proxy must not session-gate. */
export function isPublicApiSurface(pathname: string): boolean {
  return (
    isPublicV1Path(pathname) ||
    pathname === "/api/docs" ||
    pathname.startsWith("/api/docs/") ||
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/")
  );
}

export function publicCorsPreflight(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_API_CORS_HEADERS });
}
