#!/usr/bin/env node
/**
 * Rewrite a Cloud Run unix-socket DATABASE_URL for Cloud SQL Auth Proxy on localhost.
 * Never logs the URL. Use --exec to run a child with the rewritten env.
 *
 * Always sets sslmode=disable on the rewritten URL. Auth Proxy already encrypts
 * the hop to Cloud SQL; sslmode=require against 127.0.0.1 caused ECONNRESET
 * (the local proxy port is plain TCP).
 *
 * Accepts the same Secret Manager shapes as apps/web runtime:
 *   - empty host (`@/dbname?host=/cloudsql/…`)
 *   - already-normalized `@localhost/dbname?host=/cloudsql/…`
 *   - `@localhost?host=/cloudsql/…` (no path)
 * Query `host=` is stripped so postgres.js / node-pg do not send it as a GUC
 * (Postgres 42704). The unix-socket path is not needed on the Auth Proxy hop.
 *
 * Helpers below mirror `apps/web/src/db/env.ts` (plain Node here; no tsx).
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROXY_HOST = process.env.GB_PROXY_LISTEN?.trim() || "127.0.0.1:5432";

/** Cloud SQL (`/cloudsql/...`) or any unix socket absolute path from `?host=`. */
export function unixSocketHostParam(url) {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return null;
  const host = new URLSearchParams(url.slice(queryStart + 1)).get("host");
  if (!host) return null;
  return host.startsWith("/") ? host : null;
}

/**
 * Drop unix-socket `host=` from the query. Keep other params. No-op when
 * `host` is missing or not an absolute path (TCP URLs stay unchanged).
 */
export function stripUnixSocketHostQuery(databaseUrl) {
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

function hasEmptyHostname(url) {
  try {
    return new URL(url).hostname === "";
  } catch {
    return /^(postgres(?:ql)?:\/\/)(?:[^/?#]*@)?\//i.test(url);
  }
}

function withLocalhostHostname(url) {
  return url.replace(
    /^(postgres(?:ql)?:\/\/)(?:([^/?#]*)@)?\//i,
    (_match, scheme, userinfo) =>
      userinfo != null && userinfo !== ""
        ? `${scheme}${userinfo}@localhost/`
        : `${scheme}localhost/`,
  );
}

/** Rewrite empty-host unix-socket URLs so `new URL` can parse them. */
export function normalizeDatabaseUrl(databaseUrl) {
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

function postgresUserinfo(url) {
  const match = url.match(/^postgres(?:ql)?:\/\/([^@/?#]*)@/i);
  return match ? match[1] : "";
}

/**
 * @param {string} url
 * @param {string} [listen]
 * @returns {string}
 */
export function rewriteDatabaseUrlForProxy(url, listen = PROXY_HOST) {
  const raw = url.trim();
  if (!raw) {
    throw new Error("DATABASE_URL is empty");
  }

  const socket = unixSocketHostParam(raw);
  const mentionsCloudSql = raw.includes("/cloudsql/") || raw.includes("host=/cloudsql");
  if (!socket && !mentionsCloudSql) {
    return raw;
  }
  if (!socket) {
    throw new Error("DATABASE_URL unix-socket shape is not recognized");
  }

  const normalized = normalizeDatabaseUrl(raw);
  const stripped = stripUnixSocketHostQuery(normalized);

  let parsed;
  try {
    parsed = new URL(stripped);
  } catch {
    throw new Error("DATABASE_URL unix-socket shape is not recognized");
  }

  const auth = postgresUserinfo(stripped);
  if (!auth) {
    throw new Error("DATABASE_URL unix-socket shape is not recognized");
  }

  const pathname = parsed.pathname === "/" ? "" : parsed.pathname;
  const params = parsed.searchParams;
  // Auth Proxy already encrypts to Cloud SQL. Force disable so node-pg does
  // not try TLS to the local proxy (sslmode=require → ECONNRESET).
  params.set("sslmode", "disable");
  const qs = params.toString();
  return `postgresql://${auth}@${listen}${pathname}${qs ? `?${qs}` : ""}`;
}

function usage() {
  process.stderr.write(
    [
      "Rewrite Cloud SQL unix-socket DATABASE_URL for Auth Proxy (sslmode=disable).",
      "Accepts empty-host and Secret Manager @localhost?host=/cloudsql/… shapes.",
      "Never prints the URL. Proxy already encrypts to Cloud SQL.",
      "",
      "  node infra/gcloud/proxy-database-url.mjs --exec <command> [args...]",
      "",
      "Reads DATABASE_URL from the environment (Secret Manager / shell). Do not echo it.",
      "",
    ].join("\n"),
  );
}

const args = process.argv.slice(2);

const isDirect = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirect && args[0] === "--exec") {
  const command = args[1];
  if (!command) {
    usage();
    process.exit(2);
  }
  const rewritten = rewriteDatabaseUrlForProxy(process.env.DATABASE_URL ?? "");
  const child = spawn(command, args.slice(2), {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: rewritten },
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
} else if (isDirect) {
  usage();
  process.exit(2);
}
