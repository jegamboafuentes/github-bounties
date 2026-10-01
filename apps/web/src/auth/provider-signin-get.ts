/**
 * Auth.js treats `GET /api/auth/signin/<provider>` as unsupported. The provider
 * sign-in action is `POST` with a CSRF token; a GET throws `UnknownAction` and
 * `logger.error` records it. Bots hit that URL. This response never calls
 * Auth.js, so nothing is logged. Callbacks, sign-out, and the POST stay on
 * the Auth.js handlers.
 */
import type { EnvMap } from "./env";
import { adminConsoleOrigin } from "@/admin/hosts";
import { configuredPublicOrigin, originFromSiteUrl } from "@/lib/site-env";

const PROVIDER_SIGNIN_GET = /^\/api\/auth\/signin\/[^/]+\/?$/;

export function isProviderSignInGet(pathname: string): boolean {
  return PROVIDER_SIGNIN_GET.test(pathname);
}

/**
 * A callbackUrl is carried only when it is a relative path: one leading `/`,
 * not `//`, and not a scheme. Anything else is dropped so Location cannot be
 * an open redirect.
 */
function callbackOrigins(env: EnvMap, extraOrigins: readonly string[]): Set<string> {
  const origins = new Set<string>();
  for (const value of [env.PUBLIC_BASE_URL, env.AUTH_URL, configuredPublicOrigin(env), ...extraOrigins]) {
    const origin = originFromSiteUrl(value);
    if (origin) origins.add(origin);
  }
  return origins;
}

/**
 * A callbackUrl is carried when it is a relative path, or an absolute URL on
 * the same origin as PUBLIC_BASE_URL / AUTH_URL (or a pinned admin host).
 * Anything else is dropped so Location cannot be an open redirect.
 */
export function safeRelativeCallbackUrl(
  value: string | null | undefined,
  env: EnvMap = process.env,
  extraOrigins: readonly string[] = [],
): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw.includes("\\") || /[\u0000-\u001F\u007F]/.test(raw)) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null;
    return raw;
  }
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    if (!callbackOrigins(env, extraOrigins).has(url.origin)) return null;
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (!path.startsWith("/") || path.startsWith("//")) return null;
    return path;
  } catch {
    return null;
  }
}

/**
 * Cloud Run's `request.url` is the container bind address (`http://0.0.0.0:8080`).
 * An absolute Location uses only the configured public origin (`PUBLIC_BASE_URL`,
 * then `AUTH_URL`). Request host headers are ignored: `x-forwarded-host` is
 * caller-controlled and would be an open redirect. A missing, loopback, or bind
 * origin becomes a relative `Location: /signin`.
 */
export function providerSignInLocation(
  env: EnvMap = process.env,
  callbackUrl?: string | null,
  hostHeader?: string | null,
): string {
  const adminOrigin = adminConsoleOrigin(hostHeader);
  const origin = adminOrigin ?? configuredPublicOrigin(env);
  const base = origin ? `${origin}/signin` : "/signin";
  const safe = safeRelativeCallbackUrl(callbackUrl, env, adminOrigin ? [adminOrigin] : []);
  if (!safe) return base;
  return `${base}?callbackUrl=${encodeURIComponent(safe)}`;
}

/** 303 to the site sign-in page. Null means the Auth.js GET handler should run. */
export function providerSignInGetResponse(
  url: URL,
  options?: { env?: EnvMap; host?: string | null },
): Response | null {
  if (!isProviderSignInGet(url.pathname)) return null;
  return new Response(null, {
    status: 303,
    headers: {
      location: providerSignInLocation(
        options?.env,
        url.searchParams.get("callbackUrl"),
        options?.host,
      ),
    },
  });
}
