/**
 * Auth.js treats `GET /api/auth/signin/<provider>` as unsupported. The provider
 * sign-in action is `POST` with a CSRF token; a GET throws `UnknownAction` and
 * `logger.error` records it. Bots hit that URL. This response never calls
 * Auth.js, so nothing is logged. Callbacks, sign-out, and the POST stay on
 * the Auth.js handlers.
 */
import type { EnvMap } from "./env";
import { configuredPublicOrigin } from "@/lib/site-env";

const PROVIDER_SIGNIN_GET = /^\/api\/auth\/signin\/[^/]+\/?$/;

export function isProviderSignInGet(pathname: string): boolean {
  return PROVIDER_SIGNIN_GET.test(pathname);
}

/**
 * A callbackUrl is carried only when it is a relative path: one leading `/`,
 * not `//`, and not a scheme. Anything else is dropped so Location cannot be
 * an open redirect.
 */
export function safeRelativeCallbackUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  if (/[\u0000-\u001F\u007F]/.test(raw)) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null;
  return raw;
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
): string {
  const origin = configuredPublicOrigin(env);
  const base = origin ? `${origin}/signin` : "/signin";
  const safe = safeRelativeCallbackUrl(callbackUrl);
  if (!safe) return base;
  return `${base}?callbackUrl=${encodeURIComponent(safe)}`;
}

/** 303 to the site sign-in page. Null means the Auth.js GET handler should run. */
export function providerSignInGetResponse(
  url: URL,
  options?: { env?: EnvMap },
): Response | null {
  if (!isProviderSignInGet(url.pathname)) return null;
  return new Response(null, {
    status: 303,
    headers: {
      location: providerSignInLocation(options?.env, url.searchParams.get("callbackUrl")),
    },
  });
}
