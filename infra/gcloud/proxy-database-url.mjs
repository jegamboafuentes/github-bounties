#!/usr/bin/env node
/**
 * Rewrite a Cloud Run unix-socket DATABASE_URL for Cloud SQL Auth Proxy on localhost.
 * Never logs the URL. Use --exec to run a child with the rewritten env.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROXY_HOST = process.env.GB_PROXY_LISTEN?.trim() || "127.0.0.1:5432";

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
  if (!raw.includes("/cloudsql/") && !raw.includes("host=/cloudsql")) {
    return raw;
  }

  // Unix-socket URLs have an empty host (`postgresql://user:pass@/db?host=/cloudsql/...`).
  // WHATWG URL rejects that; parse the known Cloud SQL shape instead.
  const match = raw.match(/^(postgres(?:ql)?:\/\/)([^@/]+)@\/([^?]+)(?:\?(.*))?$/i);
  if (!match) {
    throw new Error("DATABASE_URL unix-socket shape is not recognized");
  }

  const auth = match[2];
  const dbName = match[3];
  const params = new URLSearchParams(match[4] ?? "");
  params.delete("host");
  if (!params.get("sslmode")) {
    params.set("sslmode", "require");
  }
  const qs = params.toString();
  return `postgresql://${auth}@${listen}/${dbName}${qs ? `?${qs}` : ""}`;
}

function usage() {
  process.stderr.write(
    [
      "Rewrite Cloud SQL unix-socket DATABASE_URL for Auth Proxy. Never prints the URL.",
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
