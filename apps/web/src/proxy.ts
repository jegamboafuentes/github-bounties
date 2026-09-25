import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { PUBLIC_API_CORS_HEADERS, publicSurfaceDispatch } from "@/api/public/cors";
import { authConfig } from "@/auth/config";
import { hasSessionSecret } from "@/auth/env";
import { isProtectedApiPath, isProtectedPagePath } from "@/auth/paths";

const { auth } = NextAuth(authConfig);

/**
 * Session gate for pages and cookie APIs. Not used for `/api/v1`, `/api/docs`,
 * or `/mcp` — those paths must not decode the Auth.js cookie (a fake session
 * JWT logs JWTSessionError on every request) and must not set csrf-token or
 * callback-url cookies, including on 405.
 */
const sessionProxy = auth((req) => {
  const pathname = req.nextUrl.pathname;
  const signedIn = hasSessionSecret() && Boolean(req.auth);

  if (isProtectedApiPath(pathname) && !signedIn) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (isProtectedPagePath(pathname) && !signedIn) {
    const signin = new URL("/signin", req.nextUrl.origin);
    const callback = `${pathname}${req.nextUrl.search}`;
    signin.searchParams.set("callbackUrl", callback);
    return NextResponse.redirect(signin);
  }

  return NextResponse.next();
});

/**
 * Next.js 16 proxy (replaces middleware.ts).
 * Unauthenticated callers cannot hit /settings, /bounties/new, GitHub install
 * return pages, /api/me, or /api/github/connect. Webhooks are not matched (HMAC).
 *
 * `/api/v1`, `/api/docs`, and `/mcp` skip Auth.js entirely. Bearer is the only
 * credential. OPTIONS on `/api/v1` and `/mcp` is the CORS preflight.
 */
export default function proxy(req: NextRequest) {
  const dispatch = publicSurfaceDispatch(req.nextUrl.pathname, req.method);
  if (dispatch === "preflight") {
    return new NextResponse(null, { status: 204, headers: PUBLIC_API_CORS_HEADERS });
  }
  if (dispatch === "bypass") return NextResponse.next();
  return sessionProxy(req);
}

export const config = {
  matcher: [
    "/settings",
    "/api/me",
    "/api/github/connect",
    "/github/setup",
    "/github/callback",
    "/bounties/new",
    "/api/v1/:path*",
    "/api/docs",
    "/api/docs/:path*",
    "/mcp",
  ],
};
