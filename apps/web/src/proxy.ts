import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth/config";
import { hasSessionSecret } from "@/auth/env";
import { isProtectedApiPath, isProtectedPagePath } from "@/auth/paths";

const { auth } = NextAuth(authConfig);

/**
 * Next.js 16 proxy (replaces middleware.ts).
 * Unauthenticated callers cannot hit /settings, /bounties/new, GitHub install
 * return pages, /api/me, or /api/github/connect. Webhooks are not matched (HMAC).
 */
export default auth((req) => {
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

export const config = {
  matcher: [
    "/settings",
    "/api/me",
    "/api/github/connect",
    "/github/setup",
    "/github/callback",
    "/bounties/new",
  ],
};
