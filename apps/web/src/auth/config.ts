import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";
import { sessionCookieOptions } from "./cookies";
import { readGoogleOAuthEnv, resolveAuthSecret } from "./env";

/**
 * Edge-safe Auth.js config (no Postgres).
 * Node handlers in `./index.ts` add jwt upsert of users.google_sub.
 */
const google = readGoogleOAuthEnv();
const sessionCookie = sessionCookieOptions();

export const authConfig = {
  trustHost: true,
  secret: resolveAuthSecret(),
  providers: [
    Google({
      clientId: google.clientId,
      clientSecret: google.clientSecret,
      // Pin the authorization endpoint so sign-in does not discover it, and
      // require state as well as PKCE. Both cookies are host-only.
      authorization: {
        url: "https://accounts.google.com/o/oauth2/v2/auth",
        params: { scope: "openid email profile" },
      },
      checks: ["pkce", "state"],
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/signin",
  },
  useSecureCookies: sessionCookie.options.secure,
  cookies: {
    sessionToken: {
      name: sessionCookie.name,
      options: sessionCookie.options,
    },
  },
} satisfies NextAuthConfig;
