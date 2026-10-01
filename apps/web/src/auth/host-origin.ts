/**
 * Auth.js action URLs when AUTH_URL is set.
 *
 * next-auth 5.0.0-beta.32 `reqWithEnvURL` (auth proxy and route handlers) and
 * `createActionURL` (server-action signIn / signOut) use AUTH_URL and ignore
 * the request host. `trustHost` does not override that. Unsetting AUTH_URL
 * would make Auth.js trust `x-forwarded-host` before this app's proxy runs,
 * so a spoofed host could become the OAuth redirect_uri.
 *
 * AUTH_URL stays the public origin. This module rewrites an Auth.js request
 * only onto an origin we construct from an allowlist: the pinned admin
 * hostnames, otherwise AUTH_URL / NEXTAUTH_URL, otherwise PUBLIC_BASE_URL.
 * The allowlist key is the Host header. Client `X-Forwarded-Host` is ignored.
 * A Host value that is not on the list is never copied into a redirect or an
 * OAuth redirect_uri.
 */
import { ADMIN_DEV_HOST, ADMIN_PROD_HOST, adminConsoleOrigin, hostnameFromHeader } from "@/admin/hosts";
import type { EnvMap } from "./env";
import { mappedHostHeader, originFromSiteUrl } from "@/lib/site-env";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function requestHostHeader(headers: { get(name: string): string | null }): string | null {
  return mappedHostHeader(headers);
}

function configuredAuthOrigin(env: EnvMap): string | null {
  return (
    originFromSiteUrl(env.AUTH_URL) ??
    originFromSiteUrl(env.NEXTAUTH_URL) ??
    originFromSiteUrl(env.PUBLIC_BASE_URL)
  );
}

/**
 * Local dev only, and only when no AUTH_URL / PUBLIC_BASE_URL is set.
 * The hostname must be loopback. The header is not used as the origin string.
 */
function loopbackAuthOrigin(hostHeader: string | null | undefined): string | null {
  const first = hostHeader?.split(",")[0]?.trim().toLowerCase() ?? "";
  const host = hostnameFromHeader(first);
  if (!LOOPBACK_HOSTS.has(host)) return null;
  const port = /:(\d+)$/.exec(first)?.[1] ?? "3000";
  const name = host === "::1" ? "[::1]" : host;
  return `http://${name}:${port}`;
}

/**
 * Origin for Auth.js (OAuth redirect_uri, callback, sign-out).
 * An allowlisted admin host wins over AUTH_URL. Anything else uses the
 * configured public origin. Never the raw request host.
 */
export function allowlistedAuthOrigin(
  hostHeader: string | null | undefined,
  env: EnvMap = process.env,
): string | null {
  return adminConsoleOrigin(hostHeader) ?? configuredAuthOrigin(env) ?? loopbackAuthOrigin(hostHeader);
}

/** Rewrite an Auth.js request onto the allowlisted origin. Drops client X-Forwarded-Host. */
export function prepareAuthRequest(request: Request, env: EnvMap = process.env): Request {
  const headers = new Headers(request.headers);
  headers.delete("x-forwarded-host");
  const origin = allowlistedAuthOrigin(requestHostHeader(request.headers), env);
  const current = new URL(request.url);
  const url =
    origin && current.origin !== origin ? new URL(`${current.pathname}${current.search}`, origin) : request.url;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(url, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    ...(hasBody ? { duplex: "half" } : {}),
  });
}

function allowedCallbackOrigins(baseUrl: string, env: EnvMap): Set<string> {
  const allowed = new Set<string>([
    `https://${ADMIN_DEV_HOST}`,
    `https://${ADMIN_PROD_HOST}`,
  ]);
  if (baseUrl) allowed.add(baseUrl);
  for (const value of [env.AUTH_URL, env.NEXTAUTH_URL, env.PUBLIC_BASE_URL]) {
    const origin = originFromSiteUrl(value);
    if (origin) allowed.add(origin);
  }
  return allowed;
}

/**
 * Post-login Location. Relative paths stay on `baseUrl` (the allowlisted
 * request origin). Absolute URLs are kept only when that origin is the
 * public site or a pinned admin host.
 */
export function allowlistedCallbackUrl(
  url: string,
  baseUrl: string,
  env: EnvMap = process.env,
): string {
  if (
    url.startsWith("/") &&
    !url.startsWith("//") &&
    !url.includes("\\") &&
    !/[\u0000-\u001F\u007F]/.test(url) &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)
  ) {
    return `${baseUrl}${url}`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return baseUrl;
    if (allowedCallbackOrigins(baseUrl, env).has(parsed.origin)) return url;
  } catch {
    /* not a URL */
  }
  return baseUrl;
}
