import { secureAuthCookiesEnabled } from "../auth/cookies";

export const HF_CONNECT_COOKIE = "hf_connect_pkce";

function cookieFlags(secure: boolean, maxAge: number): string {
  const parts = ["HttpOnly", "SameSite=Lax", "Path=/huggingface/callback", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function hfConnectCookieHeader(verifier: string, nodeEnv?: string): string {
  const secure = secureAuthCookiesEnabled(nodeEnv);
  return `${HF_CONNECT_COOKIE}=${verifier}; ${cookieFlags(secure, 30 * 60)}`;
}

export function clearHfConnectCookieHeader(nodeEnv?: string): string {
  const secure = secureAuthCookiesEnabled(nodeEnv);
  return `${HF_CONNECT_COOKIE}=; ${cookieFlags(secure, 0)}`;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    return value || null;
  }
  return null;
}
