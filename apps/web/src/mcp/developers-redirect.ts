/**
 * `/developers` was the setup page. It now lives at `/mcp`.
 * 308 is a permanent redirect. Location is a relative path so the response
 * never copies the request host.
 */
export function isLegacyDevelopersPath(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return path === "/developers" || path.startsWith("/developers/");
}

export function developersToMcpRedirect(url: URL): Response | null {
  if (!isLegacyDevelopersPath(url.pathname)) return null;
  return new Response(null, {
    status: 308,
    headers: { Location: "/mcp" },
  });
}
