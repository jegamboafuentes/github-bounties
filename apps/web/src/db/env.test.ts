import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadDatabaseUrl,
  normalizeDatabaseUrl,
  stripUnixSocketHostQuery,
} from "./env";

const FAKE_PASSWORD = "fake-password";
const CLOUD_SQL_SOCKET =
  "/cloudsql/experiment-jegf:us-central1:github-bounties-staging";

describe("normalizeDatabaseUrl", () => {
  it("rewrites empty host when host= is a Cloud SQL unix socket", () => {
    const raw = `postgresql://gb_app:${FAKE_PASSWORD}@/github_bounties?host=${CLOUD_SQL_SOCKET}`;
    assert.throws(() => new URL(raw), /Invalid URL/);

    const normalized = normalizeDatabaseUrl(raw);
    assert.equal(
      normalized,
      `postgresql://gb_app:${FAKE_PASSWORD}@localhost/github_bounties?host=${CLOUD_SQL_SOCKET}`,
    );
    const parsed = new URL(normalized);
    assert.equal(parsed.hostname, "localhost");
    assert.equal(parsed.searchParams.get("host"), CLOUD_SQL_SOCKET);
    assert.equal(parsed.username, "gb_app");
    assert.equal(parsed.password, FAKE_PASSWORD);
    assert.equal(parsed.pathname, "/github_bounties");
  });

  it("rewrites empty host when host= is an absolute unix socket path", () => {
    const raw = `postgresql://gb_app:${FAKE_PASSWORD}@/github_bounties?host=/var/run/postgresql`;
    const parsed = new URL(normalizeDatabaseUrl(raw));
    assert.equal(parsed.hostname, "localhost");
    assert.equal(parsed.searchParams.get("host"), "/var/run/postgresql");
  });

  it("leaves already-parseable URLs unchanged", () => {
    const local = `postgresql://gb_app:${FAKE_PASSWORD}@127.0.0.1:5432/github_bounties?sslmode=require`;
    const socket = `postgresql://gb_app:${FAKE_PASSWORD}@localhost/github_bounties?host=${CLOUD_SQL_SOCKET}`;
    assert.equal(normalizeDatabaseUrl(local), local);
    assert.equal(normalizeDatabaseUrl(socket), socket);
  });

  it("does not rewrite empty host without a unix-socket host= query", () => {
    const raw = `postgresql://gb_app:${FAKE_PASSWORD}@/github_bounties`;
    assert.equal(normalizeDatabaseUrl(raw), raw);
  });
});

describe("stripUnixSocketHostQuery", () => {
  it("removes host= and keeps other query params", () => {
    const raw = `postgresql://gb_app:${FAKE_PASSWORD}@localhost/github_bounties?sslmode=disable&host=${CLOUD_SQL_SOCKET}`;
    const stripped = stripUnixSocketHostQuery(raw);
    assert.equal(stripped.includes("host="), false);
    const parsed = new URL(stripped);
    assert.equal(parsed.searchParams.has("host"), false);
    assert.equal(parsed.searchParams.get("sslmode"), "disable");
    assert.equal(parsed.hostname, "localhost");
    assert.equal(parsed.password, FAKE_PASSWORD);
  });

  it("leaves TCP URLs unchanged", () => {
    const tcp = `postgresql://gb_app:${FAKE_PASSWORD}@127.0.0.1:5432/github_bounties?sslmode=require`;
    assert.equal(stripUnixSocketHostQuery(tcp), tcp);
  });
});

describe("loadDatabaseUrl", () => {
  it("normalizes Cloud Run unix-socket DATABASE_URL from the environment", () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `postgresql://gb_app:${FAKE_PASSWORD}@/github_bounties?host=${CLOUD_SQL_SOCKET}`;
    try {
      assert.equal(
        loadDatabaseUrl(),
        `postgresql://gb_app:${FAKE_PASSWORD}@localhost/github_bounties?host=${CLOUD_SQL_SOCKET}`,
      );
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});
