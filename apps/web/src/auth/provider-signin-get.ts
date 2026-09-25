/**
 * Auth.js treats `GET /api/auth/signin/<provider>` as unsupported. The provider
 * sign-in action is `POST` with a CSRF token; a GET throws `UnknownAction` and
 * `logger.error` records it. Bots hit that URL. This response never calls
 * Auth.js, so nothing is logged. Callbacks, sign-out, and the POST stay on
 * the Auth.js handlers.
 */
import type { EnvMap } from "./env";
import { readPublicSiteOrigin } from "@/lib/site-env";

const PROVIDER_SIGNIN_GET = /^\/api\/auth\/signin\/[^/]+\/?$/;

export function isProviderSignInGet(pathname: string): boolean {
  return PROVIDER_SIGNIN_GET.test(pathname);
}

/**
 * Cloud Run's `request.url` is the container bind address (`http://0.0.0.0:8080`).
 * Absolute redirects use the public origin (`PUBLIC_BASE_URL`, `AUTH_URL`, or
 * `x-forwarded-host` / `x-forwarded-proto`). A loopback or bind origin becomes
 * a relative `Location: /signin`, which the browser resolves on the host it called.
 */
export function providerSignInLocation(
  env: EnvMap = process.env,
  request?: { host?: string | null; proto?: string | null },
): string {
  const origin = readPublicSiteOrigin(env, request);
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
  options?: {
    env?: EnvMap;
    host?: string | null;
    proto?: string | null;
  },
): Response | null {
  if (!isProviderSignInGet(url.pathname)) return null;
  const location = providerSignInLocation(options?.env, {
    host: options?.host,
    proto: options?.proto,
  });
  return new Response(null, {
    status: 303,
    headers: { location },
  });
}
