import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  normalizeDatabaseUrl,
  rewriteDatabaseUrlForProxy,
  stripUnixSocketHostQuery,
  unixSocketHostParam,
} from "./proxy-database-url.mjs";

const CLOUD_SQL_SOCKET =
  "/cloudsql/experiment-jegf:us-central1:github-bounties-staging";
const FAKE_PASSWORD = "not-a-real-password";
/** Secret Manager source shape Ops uses for Cloud Run (after #19 normalize). */
const SM_LOCALHOST_URL = `postgresql://gb_app:${FAKE_PASSWORD}@localhost/github_bounties?host=${CLOUD_SQL_SOCKET}`;
const SM_LOCALHOST_NO_PATH = `postgresql://gb_app:${FAKE_PASSWORD}@localhost?host=${CLOUD_SQL_SOCKET}`;
const EMPTY_HOST_URL = `postgresql://gb_app:${FAKE_PASSWORD}@/github_bounties?host=${CLOUD_SQL_SOCKET}`;
const PROXY_TCP = `postgresql://gb_app:${FAKE_PASSWORD}@127.0.0.1:5432/github_bounties?sslmode=disable`;
const HELPER = fileURLToPath(new URL("./proxy-database-url.mjs", import.meta.url));

describe("unixSocketHostParam / normalize / strip (mirrored from apps/web)", () => {
  it("reads the Cloud SQL unix-socket path from host=", () => {
    assert.equal(unixSocketHostParam(SM_LOCALHOST_URL), CLOUD_SQL_SOCKET);
    assert.equal(unixSocketHostParam(SM_LOCALHOST_NO_PATH), CLOUD_SQL_SOCKET);
    assert.equal(unixSocketHostParam(EMPTY_HOST_URL), CLOUD_SQL_SOCKET);
  });

  it("leaves the SM @localhost?host=/cloudsql shape parseable (no empty-host rewrite)", () => {
    assert.equal(normalizeDatabaseUrl(SM_LOCALHOST_URL), SM_LOCALHOST_URL);
    const parsed = new URL(SM_LOCALHOST_URL);
    assert.equal(parsed.hostname, "localhost");
    assert.equal(parsed.searchParams.get("host"), CLOUD_SQL_SOCKET);
  });

  it("rewrites empty host when host= is a Cloud SQL unix socket", () => {
    assert.throws(() => new URL(EMPTY_HOST_URL), /Invalid URL/);
    assert.equal(normalizeDatabaseUrl(EMPTY_HOST_URL), SM_LOCALHOST_URL);
  });

  it("strips host= so it is not forwarded as a PG GUC", () => {
    const stripped = stripUnixSocketHostQuery(SM_LOCALHOST_URL);
    assert.equal(stripped.includes("host="), false);
    assert.equal(new URL(stripped).searchParams.has("host"), false);
    assert.equal(new URL(stripped).pathname, "/github_bounties");
  });
});

describe("rewriteDatabaseUrlForProxy", () => {
  it("rewrites Cloud Run empty-host unix-socket URLs to Auth Proxy localhost", () => {
    assert.equal(rewriteDatabaseUrlForProxy(EMPTY_HOST_URL), PROXY_TCP);
  });

  it("rewrites the Secret Manager @localhost?host=/cloudsql/… shape Ops uses", () => {
    assert.equal(rewriteDatabaseUrlForProxy(SM_LOCALHOST_URL), PROXY_TCP);
  });

  it("rewrites @localhost?host=/cloudsql/… when the path is omitted", () => {
    const out = rewriteDatabaseUrlForProxy(SM_LOCALHOST_NO_PATH);
    assert.equal(out, `postgresql://gb_app:${FAKE_PASSWORD}@127.0.0.1:5432?sslmode=disable`);
    assert.doesNotMatch(out, /host=/);
    assert.doesNotMatch(out, /cloudsql/);
  });

  it("leaves a proxy-shaped URL unchanged", () => {
    assert.equal(rewriteDatabaseUrlForProxy(PROXY_TCP), PROXY_TCP);
  });

  it("forces sslmode=disable even when the socket URL had another sslmode", () => {
    const input = `${EMPTY_HOST_URL}&sslmode=require`;
    const out = rewriteDatabaseUrlForProxy(input);
    assert.match(out, /127\.0\.0\.1:5432/);
    assert.match(out, /sslmode=disable/);
    assert.doesNotMatch(out, /sslmode=require/);
    assert.doesNotMatch(out, /cloudsql/);
    assert.doesNotMatch(out, /host=/);
  });

  it("rejects an empty URL", () => {
    assert.throws(() => rewriteDatabaseUrlForProxy("  "), /empty/);
  });
});

describe("proxy-database-url --exec CLI", () => {
  it("accepts the SM @localhost?host=/cloudsql URL without reject", () => {
    const result = spawnSync(
      process.execPath,
      [
        HELPER,
        "--exec",
        process.execPath,
        "-e",
        [
          "const u = process.env.DATABASE_URL ?? '';",
          "if (u.includes('unix-socket shape is not recognized')) process.exit(9);",
          "if (!u.includes('127.0.0.1:5432')) process.exit(10);",
          "if (u.includes('host=')) process.exit(11);",
          "if (!u.includes('sslmode=disable')) process.exit(12);",
          "if (u.includes('cloudsql')) process.exit(13);",
          "if (!u.includes('/github_bounties')) process.exit(14);",
          "process.exit(0);",
        ].join(""),
      ],
      {
        env: { ...process.env, DATABASE_URL: SM_LOCALHOST_URL },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
