import type { EnvMap } from "../auth/env";

/** Custom-domain host for the DEV Cloud Run service. */
export const DEV_SITE_HOST = "dev.githubbounties.xyz";
/** Apex host for production. Must never show the DEV pill. */
export const PROD_SITE_HOST = "githubbounties.xyz";
/** Cloud Run service name for production (K_SERVICE). */
export const PROD_CLOUD_RUN_SERVICE = "github-bounties-web-prod";
/** Cloud Run service name for DEV. */
export const DEV_CLOUD_RUN_SERVICE = "github-bounties-web";

function hostnameOf(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch {
    return trimmed.split("/")[0]?.split(":")[0]?.toLowerCase() ?? "";
  }
}

function isProdHost(host: string): boolean {
  return host === PROD_SITE_HOST || host === `www.${PROD_SITE_HOST}`;
}

function isDevHost(host: string): boolean {
  return host === DEV_SITE_HOST || host.endsWith(`.${DEV_SITE_HOST}`);
}

/** Local fallback when no public origin is configured. Crawlers cannot fetch this. */
export const LOCAL_SITE_ORIGIN = "http://localhost:3000";

/**
 * Absolute origin (no path) from a URL or bare host.
 * `https://dev.githubbounties.xyz/path/` → `https://dev.githubbounties.xyz`.
 */
export function originFromSiteUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function firstHeaderValue(value: string | null | undefined): string {
  return value?.split(",")[0]?.trim() ?? "";
}

/**
 * Public site origin for absolute URLs (Open Graph, Twitter, share images).
 * Preference matches WalletConnect / x402 / email: `PUBLIC_BASE_URL`, then
 * `AUTH_URL`. When neither is set, use the incoming https host so a crawler
 * that hit DEV or PROD still gets an absolute URL on that host. Localhost
 * only when nothing public is available.
 */
export function readPublicSiteOrigin(
  env: EnvMap = process.env,
  request?: { host?: string | null; proto?: string | null },
): string {
  const configured =
    originFromSiteUrl(env.PUBLIC_BASE_URL) || originFromSiteUrl(env.AUTH_URL);
  if (configured) return configured;

  const host = firstHeaderValue(request?.host);
  const hostname = hostnameOf(host);
  const isLocal =
    !hostname || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (!isLocal) {
    const protoRaw = firstHeaderValue(request?.proto).toLowerCase();
    const proto = protoRaw === "http" ? "http" : "https";
    const fromRequest = originFromSiteUrl(`${proto}://${host}`);
    if (fromRequest) return fromRequest;
  }

  return LOCAL_SITE_ORIGIN;
}

/**
 * Whether to render the header “DEV” pill.
 * True on `dev.githubbounties.xyz` (AUTH_URL / PUBLIC_BASE_URL / request host)
 * or APP_ENV/GB_ENV=dev|staging, or Cloud Run `github-bounties-web`.
 * Never true on apex `githubbounties.xyz` or `github-bounties-web-prod`.
 */
export function isDevSite(args: { env?: EnvMap; host?: string | null } = {}): boolean {
  const env = args.env ?? process.env;
  const service = (env.K_SERVICE ?? "").trim();
  if (service === PROD_CLOUD_RUN_SERVICE) return false;

  const appEnv = (env.APP_ENV ?? env.GB_ENV ?? "").trim().toLowerCase();
  if (appEnv === "prod" || appEnv === "production") return false;

  const hosts = [
    hostnameOf(args.host),
    hostnameOf(env.PUBLIC_BASE_URL),
    hostnameOf(env.AUTH_URL),
  ].filter(Boolean);

  if (hosts.some(isProdHost)) return false;
  if (hosts.some(isDevHost)) return true;
  if (appEnv === "dev" || appEnv === "development" || appEnv === "staging") return true;
  if (service === DEV_CLOUD_RUN_SERVICE) return true;
  return false;
}
