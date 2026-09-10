import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rewriteDatabaseUrlForProxy } from "./proxy-database-url.mjs";

describe("rewriteDatabaseUrlForProxy", () => {
  it("rewrites Cloud Run unix-socket URLs to Auth Proxy localhost", () => {
    const input =
      "postgresql://gb_app:not-a-real-password@/github_bounties?host=/cloudsql/experiment-jegf:us-central1:github-bounties-staging";
    const out = rewriteDatabaseUrlForProxy(input);
    assert.equal(
      out,
      "postgresql://gb_app:not-a-real-password@127.0.0.1:5432/github_bounties?sslmode=disable",
    );
  });

  it("leaves a proxy-shaped URL unchanged", () => {
    const input = "postgresql://gb_app:not-a-real-password@127.0.0.1:5432/github_bounties?sslmode=disable";
    assert.equal(rewriteDatabaseUrlForProxy(input), input);
  });

  it("forces sslmode=disable even when the socket URL had another sslmode", () => {
    const input =
      "postgresql://gb_app:not-a-real-password@/github_bounties?host=/cloudsql/experiment-jegf:us-central1:github-bounties-staging&sslmode=require";
    const out = rewriteDatabaseUrlForProxy(input);
    assert.match(out, /127\.0\.0\.1:5432/);
    assert.match(out, /sslmode=disable/);
    assert.doesNotMatch(out, /sslmode=require/);
    assert.doesNotMatch(out, /cloudsql/);
  });

  it("rejects an empty URL", () => {
    assert.throws(() => rewriteDatabaseUrlForProxy("  "), /empty/);
  });
});
