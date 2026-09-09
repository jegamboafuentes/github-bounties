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
