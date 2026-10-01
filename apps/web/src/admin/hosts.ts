/** Admin console hosts on the same Cloud Run service as the public site. */
export const ADMIN_DEV_HOST = "admin-dev.githubbounties.xyz";
export const ADMIN_PROD_HOST = "admin.githubbounties.xyz";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function hostnameFromHeader(value: string | null | undefined): string {
  const first = value?.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first) return "";
  if (first.startsWith("[")) {
    const end = first.indexOf("]");
    return end > 0 ? first.slice(1, end) : first;
  }
  return first.replace(/:\d+$/, "");
}

export function adminConsoleKind(hostHeader: string | null | undefined): "dev" | "prod" | null {
  const host = hostnameFromHeader(hostHeader);
  if (host === ADMIN_DEV_HOST) return "dev";
  if (host === ADMIN_PROD_HOST) return "prod";
  return null;
}

export function isAdminConsoleHost(hostHeader: string | null | undefined): boolean {
  return adminConsoleKind(hostHeader) != null;
}

export function isLocalDevHost(hostHeader: string | null | undefined): boolean {
  return LOCAL_HOSTS.has(hostnameFromHeader(hostHeader));
}

/** https origin for a pinned admin host. Anything else is null (not an open redirect). */
export function adminConsoleOrigin(hostHeader: string | null | undefined): string | null {
  const kind = adminConsoleKind(hostHeader);
  if (kind === "dev") return `https://${ADMIN_DEV_HOST}`;
  if (kind === "prod") return `https://${ADMIN_PROD_HOST}`;
  return null;
}

const ADMIN_HOST_EXACT = new Set(["/signin", "/robots.txt", "/favicon.ico", "/mcp"]);
const ADMIN_HOST_PREFIXES = ["/signin/", "/api/auth", "/api/v1/admin", "/mcp/", "/_next/"];

export type HostAction =
  | { action: "next"; robots: boolean }
  | { action: "rewrite"; pathname: string; robots: true }
  | { action: "robots" }
  | { action: "not_found"; robots: boolean };

/**
 * Public hosts 404 `/admin` and `/api/v1/admin`.
 * Admin hosts serve `/admin`, auth, admin API, and MCP. Everything else is 404.
 * Localhost still serves `/admin` so the console can be developed beside the public app.
 */
export function classifyHostRequest(hostHeader: string | null | undefined, pathname: string): HostAction {
  const admin = isAdminConsoleHost(hostHeader);
  const local = isLocalDevHost(hostHeader);
  const adminSurface =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/v1/admin" ||
    pathname.startsWith("/api/v1/admin/");

  if (!admin) {
    if (adminSurface && !local) return { action: "not_found", robots: false };
    if (adminSurface && local) return { action: "next", robots: false };
    return { action: "next", robots: false };
  }

  if (pathname === "/robots.txt") return { action: "robots" };
  if (pathname === "/") return { action: "rewrite", pathname: "/admin", robots: true };
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return { action: "next", robots: true };
  if (ADMIN_HOST_EXACT.has(pathname) || ADMIN_HOST_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return { action: "next", robots: true };
  }
  return { action: "not_found", robots: true };
}

export const ADMIN_ROBOTS_TXT = "User-agent: *\nDisallow: /\n";
export const ADMIN_ROBOTS_HEADER = "noindex, nofollow";
