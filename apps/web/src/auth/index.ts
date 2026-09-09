import NextAuth from "next-auth";
import { authConfig } from "./config";
import { hasSessionSecret } from "./env";
import { identityFromGoogleProfile, upsertUserByGoogleSub } from "./users";

/**
 * Auth.js (NextAuth v5) + Google provider.
 * JWT session cookie (httpOnly; Secure in production). On login, upsert `users` by google_sub.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      return identityFromGoogleProfile(profile ?? {}) !== null;
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "google" && profile) {
        const identity = identityFromGoogleProfile(profile);
        if (!identity) return token;
        const user = await upsertUserByGoogleSub(identity);
        token.userId = user.id;
        token.googleSub = user.googleSub;
        token.email = user.email;
        token.name = user.displayName;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.userId === "string" ? token.userId : "";
        session.user.googleSub = typeof token.googleSub === "string" ? token.googleSub : "";
        if (typeof token.email === "string") session.user.email = token.email;
        if (typeof token.name === "string") session.user.name = token.name;
      }
      return session;
    },
  },
});

/** Decode the session only when AUTH_SECRET is configured (ignore forged/dev cookies otherwise). */
export async function getOptionalSession() {
  if (!hasSessionSecret()) return null;
  try {
    return await auth();
  } catch {
    return null;
  }
}
