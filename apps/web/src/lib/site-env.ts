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
