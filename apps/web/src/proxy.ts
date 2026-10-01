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

const { auth } = NextAuth(authConfig);

function requestHost(req: { headers: Headers; nextUrl: URL }): string {
  return req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
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
 * return pages, /api/me, or /api/github/connect. Webhooks are not session-gated.
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
    const signin = new URL("/signin", req.nextUrl.origin);
    signin.searchParams.set("callbackUrl", effective);
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

export default function proxy(req: Parameters<typeof sessionProxy>[0]) {
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
  return sessionProxy(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
