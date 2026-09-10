import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { postgresConnectArgs, postgresConnectOptions } from "./client";
import { normalizeDatabaseUrl } from "./env";

const FAKE_PASSWORD = "fake-password";
const CLOUD_SQL_SOCKET =
  "/cloudsql/experiment-jegf:us-central1:github-bounties-staging";

describe("postgresConnectOptions", () => {
  it("sets options.host from a Cloud SQL unix-socket host= query", () => {
    const url = normalizeDatabaseUrl(
      `postgresql://gb_app:${FAKE_PASSWORD}@/github_bounties?host=${CLOUD_SQL_SOCKET}`,
    );
    const options = postgresConnectOptions(url);
    assert.equal(options.max, 1);
    assert.equal(options.host, CLOUD_SQL_SOCKET);
    assert.equal(typeof options.onnotice, "function");
    assert.equal("password" in options, false);
  });

  it("sets options.host for an already-normalized @localhost socket URL", () => {
    const url = `postgresql://gb_app:${FAKE_PASSWORD}@localhost/github_bounties?host=${CLOUD_SQL_SOCKET}`;
    assert.equal(postgresConnectOptions(url).host, CLOUD_SQL_SOCKET);
  });

  it("sets options.host for a local absolute unix socket path", () => {
    const url = `postgresql://gb_app:${FAKE_PASSWORD}@localhost/github_bounties?host=/var/run/postgresql`;
    assert.equal(postgresConnectOptions(url).host, "/var/run/postgresql");
  });

  it("omits host for TCP DATABASE_URL (Auth Proxy / local)", () => {
    const url = `postgresql://gb_app:${FAKE_PASSWORD}@127.0.0.1:5432/github_bounties?sslmode=require`;
    const options = postgresConnectOptions(url);
    assert.equal(options.max, 1);
    assert.equal("host" in options, false);
  });
});

describe("postgresConnectArgs", () => {
  it("strips host= from the URL and sets options.host for Cloud SQL sockets", () => {
    const raw = `postgresql://gb_app:${FAKE_PASSWORD}@/github_bounties?host=${CLOUD_SQL_SOCKET}`;
    const { url, options } = postgresConnectArgs(raw);
    assert.equal(url.includes("host="), false);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.has("host"), false);
    assert.equal(parsed.hostname, "localhost");
    assert.equal(parsed.username, "gb_app");
    assert.equal(parsed.password, FAKE_PASSWORD);
    assert.equal(parsed.pathname, "/github_bounties");
    assert.equal(options.host, CLOUD_SQL_SOCKET);
    assert.equal(options.max, 1);
  });

  it("keeps other query params when stripping host=", () => {
    const raw = `postgresql://gb_app:${FAKE_PASSWORD}@localhost/github_bounties?sslmode=disable&host=${CLOUD_SQL_SOCKET}`;
    const { url, options } = postgresConnectArgs(raw);
    assert.equal(url.includes("host="), false);
    assert.equal(new URL(url).searchParams.get("sslmode"), "disable");
    assert.equal(options.host, CLOUD_SQL_SOCKET);
  });

  it("leaves TCP URLs unchanged and omits options.host", () => {
    const tcp = `postgresql://gb_app:${FAKE_PASSWORD}@127.0.0.1:5432/github_bounties?sslmode=require`;
    const { url, options } = postgresConnectArgs(tcp);
    assert.equal(url, tcp);
    assert.equal("host" in options, false);
  });
});
