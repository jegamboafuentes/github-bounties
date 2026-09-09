/**
 * Auth.js session cookie flags (httpOnly always; Secure in production).
 * Matches @auth/core defaultCookies so proxy and Node handlers stay aligned.
 */

export type SessionCookieFlags = {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
};

export function secureAuthCookiesEnabled(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return nodeEnv === "production";
}

export function sessionCookieName(secure: boolean): string {
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}

export function sessionCookieFlags(secure: boolean): SessionCookieFlags {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
  };
}

export function sessionCookieOptions(nodeEnv?: string) {
  const secure = secureAuthCookiesEnabled(nodeEnv);
  return {
    name: sessionCookieName(secure),
    options: sessionCookieFlags(secure),
  };
}

export const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
] as const;
