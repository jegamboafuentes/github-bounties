import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { isPublicApiSurface, isPublicV1Path, PUBLIC_API_CORS_HEADERS } from "@/api/public/cors";
import { authConfig } from "@/auth/config";
import { hasSessionSecret } from "@/auth/env";
import { isProtectedApiPath, isProtectedPagePath } from "@/auth/paths";

const { auth } = NextAuth(authConfig);

/**
 * Next.js 16 proxy (replaces middleware.ts).
 * Unauthenticated callers cannot hit /settings, /bounties/new, GitHub install
 * return pages, /api/me, or /api/github/connect. Webhooks are not matched (HMAC).
 *
 * `/api/v1`, `/api/docs`, and `/mcp` are public. They are matched so a CORS
 * preflight can answer, and they return before the session checks.
 */
export default auth((req) => {
  const pathname = req.nextUrl.pathname;

  if (isPublicApiSurface(pathname)) {
    if (isPublicV1Path(pathname) && req.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: PUBLIC_API_CORS_HEADERS });
    }
    return NextResponse.next();
  }

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
