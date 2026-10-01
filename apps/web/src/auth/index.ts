import { Auth, raw, skipCSRFCheck } from "@auth/core";
import NextAuth, { type NextAuthConfig } from "next-auth";
import { authConfig } from "./config";
import { hasSessionSecret } from "./env";
import { allowlistedCallbackUrl, prepareAuthRequest } from "./host-origin";
import { persistGoogleSignIn } from "../email/sign-in";
import { identityFromGoogleProfile } from "./users";

/**
 * Auth.js (NextAuth v5) + Google provider.
 * JWT session cookie (httpOnly; Secure in production; no Domain). On login,
 * upsert `users` by google_sub.
 *
 * HTTP handlers and server actions call `@auth/core` `Auth()` on a request
 * whose URL is `prepareAuthRequest`. Stock `handlers` still go through
 * `reqWithEnvURL`, which pins every URL to AUTH_URL, so the route does not
 * use them for admin hosts.
 */
const authRuntimeConfig = {
  ...authConfig,
  basePath: "/api/auth",
  callbacks: {
    async redirect({ url, baseUrl }) {
      return allowlistedCallbackUrl(url, baseUrl);
    },
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      return identityFromGoogleProfile(profile ?? {}) !== null;
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "google" && profile) {
        const identity = identityFromGoogleProfile(profile);
        if (!identity) return token;
        const user = await persistGoogleSignIn(identity);
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
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authRuntimeConfig);

/** Auth.js HTTP handler. The request URL is the allowlisted origin, not AUTH_URL. */
export function handleAuthRequest(request: Request): Promise<Response> {
  return Auth(prepareAuthRequest(request), authRuntimeConfig);
}

export type AuthActionCookie = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

function omitCookieDomain(options: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!options) return {};
  const next = { ...options };
  delete next.domain;
  return next;
}

/**
 * Server-action sign-in and sign-out. next-auth's `signIn` posts to
 * `createActionURL`, which is AUTH_URL even when the browser is on an admin
 * host, so the Google redirect_uri and the host-only PKCE cookie would land
 * on different hosts. This posts to the allowlisted origin instead.
 * CSRF is skipped here, matching next-auth's server actions. The HTTP route
 * still checks CSRF. Cookies never get a Domain attribute.
 */
export async function performAuthAction(
  actionPath: "signin/google" | "signout",
  callbackUrl: string,
  incoming: Headers,
): Promise<{ redirect: string; cookies: AuthActionCookie[] }> {
  const headers = new Headers(incoming);
  headers.set("content-type", "application/x-www-form-urlencoded");
  const request = prepareAuthRequest(
    new Request(`http://127.0.0.1/api/auth/${actionPath}`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ callbackUrl }),
    }),
  );
  const res = (await Auth(request, { ...authRuntimeConfig, raw, skipCSRFCheck })) as
    | Response
    | { redirect?: string; cookies?: AuthActionCookie[] };
  if (res instanceof Response) {
    const redirectTo = res.headers.get("Location");
    if (!redirectTo) throw new Error("Auth.js did not return a redirect.");
    return { redirect: redirectTo, cookies: [] };
  }
  const redirectTo = typeof res?.redirect === "string" ? res.redirect : "";
  if (!redirectTo) throw new Error("Auth.js did not return a redirect.");
  const cookies = Array.isArray(res.cookies) ? res.cookies : [];
  return {
    redirect: redirectTo,
    cookies: cookies.map((cookie: AuthActionCookie) => ({
      name: cookie.name,
      value: cookie.value,
      options: omitCookieDomain(cookie.options),
    })),
  };
}

/** Decode the session only when AUTH_SECRET is configured (ignore forged/dev cookies otherwise). */
export async function getOptionalSession() {
  if (!hasSessionSecret()) return null;
  try {
    return await auth();
  } catch {
    return null;
  }
}
