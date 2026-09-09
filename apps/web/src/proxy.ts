import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth/config";
import { hasSessionSecret } from "@/auth/env";
import { isProtectedApiPath, isProtectedPagePath } from "@/auth/paths";

const { auth } = NextAuth(authConfig);

/**
 * Next.js 16 proxy (replaces middleware.ts).
 * Unauthenticated callers cannot hit /settings, /api/me, or /api/github/connect.
 */
export default auth((req) => {
  const pathname = req.nextUrl.pathname;
  const signedIn = hasSessionSecret() && Boolean(req.auth);

  if (isProtectedApiPath(pathname) && !signedIn) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (isProtectedPagePath(pathname) && !signedIn) {
    const signin = new URL("/signin", req.nextUrl.origin);
    signin.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signin);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/settings", "/api/me", "/api/github/connect"],
};
