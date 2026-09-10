import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { postgresConnectOptions } from "./client";
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
