/**
 * Browser calls to `/api/v1` and `/mcp` from any origin. No cookies and no
 * credentials. Authorization is Bearer only. Agents may also send
 * Idempotency-Key, the x402 payment headers, and Mcp-Session-Id.
 */
export const API_CORS_EXPOSE_HEADERS =
  "PAYMENT-REQUIRED, PAYMENT-RESPONSE, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After";

export const PUBLIC_API_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Accept, Authorization, Content-Type, Idempotency-Key, Mcp-Session-Id, PAYMENT-SIGNATURE, X-PAYMENT",
  "Access-Control-Expose-Headers": API_CORS_EXPOSE_HEADERS,
  "Access-Control-Max-Age": "86400",
};

/**
 * `/api/v1`, `/api/docs`, and `/mcp` skip the Auth.js middleware.
 * OPTIONS is a CORS preflight. Every other method is passed through with no
 * session decode, so a bad cookie cannot flood the logs or set csrf cookies.
 */
export function publicSurfaceDispatch(pathname: string, method: string): "preflight" | "bypass" | "session" {
  if (!isPublicApiSurface(pathname)) return "session";
  if (method === "OPTIONS") return "preflight";
  return "bypass";
}

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
