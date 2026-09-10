/**
 * Load DATABASE_URL. Never log the value (it may contain a password).
 * Staging: Secret Manager key `DATABASE_URL` (Ops sets the version OOB).
 *
 * Next.js loads `apps/web/.env` itself. Do not scan the filesystem here —
 * that traces the whole project into the Cloud Run standalone bundle.
 *
 * Cloud Run unix-socket URLs with an empty host (`@/dbname?host=/cloudsql/...`)
 * throw `Invalid URL` in Node / postgres.js. Rewrite that host to `localhost`
 * so URL parsing succeeds. Secret Manager may still document `?host=/cloudsql/...`
 * as the source shape; `createDb` extracts it as `options.host` and strips the
 * query key before `postgres()` so postgres.js does not send `host` as a GUC
 * (Postgres 42704 unrecognized configuration parameter "host").
 */

/** Cloud SQL (`/cloudsql/...`) or any unix socket absolute path from `?host=`. */
export function unixSocketHostParam(url: string): string | null {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return null;
  const host = new URLSearchParams(url.slice(queryStart + 1)).get("host");
  if (!host) return null;
  // Cloud SQL (`/cloudsql/...`) or any unix socket absolute path.
  return host.startsWith("/") ? host : null;
}

/**
 * Drop unix-socket `host=` from the query. Keep other params. No-op when
 * `host` is missing or not an absolute path (TCP URLs stay unchanged).
 */
export function stripUnixSocketHostQuery(databaseUrl: string): string {
  const url = databaseUrl.trim();
  if (!unixSocketHostParam(url)) return url;
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  const hashStart = url.indexOf("#", queryStart);
  const query =
    hashStart === -1 ? url.slice(queryStart + 1) : url.slice(queryStart + 1, hashStart);
  const hash = hashStart === -1 ? "" : url.slice(hashStart);
  const params = new URLSearchParams(query);
  params.delete("host");
  const rest = params.toString();
  const base = url.slice(0, queryStart);
  return rest ? `${base}?${rest}${hash}` : `${base}${hash}`;
}

function hasEmptyHostname(url: string): boolean {
  try {
    return new URL(url).hostname === "";
  } catch {
    return /^(postgres(?:ql)?:\/\/)(?:[^/?#]*@)?\//i.test(url);
  }
}

function withLocalhostHostname(url: string): string {
  return url.replace(
    /^(postgres(?:ql)?:\/\/)(?:([^/?#]*)@)?\//i,
    (_match, scheme: string, userinfo?: string) =>
      userinfo != null && userinfo !== ""
        ? `${scheme}${userinfo}@localhost/`
        : `${scheme}localhost/`,
  );
}

/** Rewrite empty-host unix-socket URLs so `new URL` / postgres.js can parse them. */
export function normalizeDatabaseUrl(databaseUrl: string): string {
  const url = databaseUrl.trim();
  if (!unixSocketHostParam(url) || !hasEmptyHostname(url)) {
    return url;
  }
  const rewritten = withLocalhostHostname(url);
  try {
    new URL(rewritten);
    return rewritten;
  } catch {
    return url;
  }
}

export function loadDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy apps/web/.env.example to apps/web/.env for local Postgres, or export the Secret Manager key DATABASE_URL (Ops provides the value out-of-band).",
    );
  }
  return normalizeDatabaseUrl(url);
}
