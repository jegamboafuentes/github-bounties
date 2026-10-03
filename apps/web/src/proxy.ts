import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import {
  ADMIN_ROBOTS_HEADER,
  ADMIN_ROBOTS_TXT,
  classifyHostRequest,
  isAdminConsoleHost,
} from "@/admin/hosts";
import { authConfig } from "@/auth/config";
import { hasSessionSecret } from "@/auth/env";
import { isProtectedApiPath, isProtectedPagePath } from "@/auth/paths";
import { providerSignInLocation } from "@/auth/provider-signin-get";
import { mappedHostHeader } from "@/lib/site-env";

const { auth } = NextAuth(authConfig);

function requestHost(req: { headers: Headers; nextUrl: URL }): string {
  return mappedHostHeader(req.headers) ?? req.nextUrl.host;
}

/**
 * POST /signin is the Google server action. Next.js turns a missing Origin or
 * an unreadable body into a 500. Reject those before the action handler runs.
 * A real browser submit sends Origin plus multipart (with a boundary) or
 * text/plain.
 */
function headerHostname(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim() ?? "";
  if (!first || first.toLowerCase() === "null") return null;
  try {
    if (first.includes("://")) return new URL(first).hostname.toLowerCase();
  } catch {
    return null;
  }
  const bare = first.replace(/:\d+$/, "");
  return bare.toLowerCase() || null;
}

function isServerActionPost(req: {
  method: string;
  nextUrl: { pathname: string };
  headers: { get(name: string): string | null };
}): boolean {
  if (req.method !== "POST") return false;
  const pathname = req.nextUrl.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/signin") return true;
  if (req.headers.get("next-action")) return true;
  if (pathname.startsWith("/api/") || pathname.startsWith("/webhooks") || pathname === "/mcp" || pathname.startsWith("/mcp/")) {
    return false;
  }
  const media = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  return media === "text/plain";
}

/**
 * Cloud Run sets Host to the mapped domain and forwards the client
 * X-Forwarded-Host unchanged. Next.js turns a mismatch into a 500 on server
 * actions. Reject it here.
 */
export function spoofedForwardedHostStatus(req: {
  method: string;
  nextUrl: { pathname: string };
  headers: { get(name: string): string | null };
}): 403 | null {
  if (!isServerActionPost(req)) return null;
  const forwarded = headerHostname(req.headers.get("x-forwarded-host"));
  if (!forwarded) return null;
  const host = headerHostname(req.headers.get("host"));
  const origin = headerHostname(req.headers.get("origin"));
  if (host && forwarded !== host) return 403;
  if (origin && forwarded !== origin) return 403;
  return null;
}

export function malformedSignInPostStatus(req: {
  method: string;
  nextUrl: { pathname: string };
  headers: { get(name: string): string | null };
}): 400 | null {
  if (req.method !== "POST") return null;
  const pathname = req.nextUrl.pathname.replace(/\/+$/, "") || "/";
  if (pathname !== "/signin") return null;
  const origin = req.headers.get("origin")?.trim() ?? "";
  if (!origin || origin.toLowerCase() === "null") return 400;
  const contentType = req.headers.get("content-type")?.trim() ?? "";
  const media = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (req.headers.get("content-length")?.trim() === "0") return 400;
  if (media === "multipart/form-data") return /boundary=/i.test(contentType) ? null : 400;
  if (media === "text/plain") return null;
  return 400;
}

function withRobots(response: NextResponse, robots: boolean): NextResponse {
  if (robots) response.headers.set("x-robots-tag", ADMIN_ROBOTS_HEADER);
  return response;
}

function notFound(robots: boolean): NextResponse {
  return withRobots(new NextResponse("Not Found", { status: 404 }), robots);
}

/**
 * Next.js 16 proxy (replaces middleware.ts).
 * Unauthenticated callers cannot hit /settings, /bounties/new, GitHub install
 * return pages, the Hugging Face connect return, /api/me, /api/github/connect,
 * or /api/huggingface/connect and /disconnect. Webhooks are not session-gated.
 *
 * `/api/v1`, `/api/docs`, and `/mcp` do not run the Auth.js wrapper, so a fake
 * session cookie is not decoded and responses do not set Auth.js cookies.
 * Admin hosts are the exception for page routes: `/` rewrites to `/admin`.
 */
const sessionProxy = auth((req) => {
  const pathname = req.nextUrl.pathname;
  const host = requestHost(req);
  const decision = classifyHostRequest(host, pathname);
  const signedIn = hasSessionSecret() && Boolean(req.auth);

  if (decision.action === "not_found") return notFound(decision.robots);
  if (decision.action === "robots") {
    return withRobots(
      new NextResponse(ADMIN_ROBOTS_TXT, { headers: { "content-type": "text/plain; charset=utf-8" } }),
      true,
    );
  }

  const effective = decision.action === "rewrite" ? decision.pathname : pathname;
  if (isProtectedApiPath(effective) && !signedIn) {
    return withRobots(
      NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }),
      decision.robots,
    );
  }

  if ((isProtectedPagePath(effective) || effective === "/admin" || effective.startsWith("/admin/")) && !signedIn) {
    // reqWithEnvURL rewrites nextUrl.origin to AUTH_URL before this callback.
    // The Location is built from the allowlisted host, not from that origin
    // and not from a Host header that failed the allowlist.
    const location = providerSignInLocation(process.env, effective, host);
    const signin = location.startsWith("/") ? new URL(location, req.nextUrl.origin) : new URL(location);
    return withRobots(NextResponse.redirect(signin), decision.robots);
  }

  if (decision.action === "rewrite") {
    const url = req.nextUrl.clone();
    url.pathname = decision.pathname;
    return withRobots(NextResponse.rewrite(url), true);
  }

  return withRobots(NextResponse.next(), decision.robots);
});

/**
 * Auth.js runs only for session-gated paths and unsigned admin pages.
 * `/api/v1`, `/api/docs`, and `/mcp` stay off this wrapper even though the
 * matcher is broad enough to 404 them on an admin host. A fake session cookie
 * is not decoded there, and those responses do not set Auth.js cookies.
 */
export function needsSession(pathname: string, host: string): boolean {
  if (isProtectedApiPath(pathname) || isProtectedPagePath(pathname)) return true;
  if (!isAdminConsoleHost(host)) return false;
  return pathname === "/" || pathname === "/admin" || pathname.startsWith("/admin/");
}

export default function proxy(
  req: Parameters<typeof sessionProxy>[0],
  event: Parameters<typeof sessionProxy>[1],
) {
  if (spoofedForwardedHostStatus(req) === 403) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (malformedSignInPostStatus(req) === 400) {
    return new NextResponse("Bad Request", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const pathname = req.nextUrl.pathname;
  const host = requestHost(req);
  const decision = classifyHostRequest(host, pathname);

  if (decision.action === "not_found") return notFound(decision.robots);
  if (decision.action === "robots") {
    return withRobots(
      new NextResponse(ADMIN_ROBOTS_TXT, { headers: { "content-type": "text/plain; charset=utf-8" } }),
      true,
    );
  }
  if (!needsSession(pathname, host)) {
    return withRobots(NextResponse.next(), decision.robots);
  }
  return sessionProxy(req, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
