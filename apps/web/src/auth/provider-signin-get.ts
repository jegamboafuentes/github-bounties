/**
 * Auth.js treats `GET /api/auth/signin/<provider>` as unsupported. The provider
 * sign-in action is `POST` with a CSRF token; a GET throws `UnknownAction` and
 * `logger.error` records it. Bots hit that URL. This response never calls
 * Auth.js, so nothing is logged. Callbacks, sign-out, and the POST stay on
 * the Auth.js handlers.
 */
import type { EnvMap } from "./env";
import { originFromSiteUrl } from "@/lib/site-env";

const PROVIDER_SIGNIN_GET = /^\/api\/auth\/signin\/[^/]+\/?$/;

export function isProviderSignInGet(pathname: string): boolean {
  return PROVIDER_SIGNIN_GET.test(pathname);
}

/**
 * Cloud Run's `request.url` is the container bind address (`http://0.0.0.0:8080`).
 * An absolute Location uses only the configured public origin (`PUBLIC_BASE_URL`,
 * then `AUTH_URL`). Request host headers are ignored: `x-forwarded-host` is
 * caller-controlled and would be an open redirect. A missing, loopback, or bind
 * origin becomes a relative `Location: /signin`.
 */
export function providerSignInLocation(env: EnvMap = process.env): string {
  const origin = originFromSiteUrl(env.PUBLIC_BASE_URL) || originFromSiteUrl(env.AUTH_URL);
  if (!origin) return "/signin";
  let hostname = "";
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return "/signin";
  }
  if (
    hostname === "0.0.0.0" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    return "/signin";
  }
  return `${origin}/signin`;
}

/** 303 to the site sign-in page. Null means the Auth.js GET handler should run. */
export function providerSignInGetResponse(
  url: URL,
  options?: { env?: EnvMap },
): Response | null {
  if (!isProviderSignInGet(url.pathname)) return null;
  return new Response(null, {
    status: 303,
    headers: { location: providerSignInLocation(options?.env) },
  });
}
