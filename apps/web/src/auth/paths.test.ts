import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isProtectedApiPath, isProtectedPagePath, isProtectedPath } from "./paths";

describe("protected paths", () => {
  it("protects settings and /api/me, not health or auth routes", () => {
    assert.equal(isProtectedPagePath("/settings"), true);
    assert.equal(isProtectedPagePath("/settings/wallet"), true);
    assert.equal(isProtectedPagePath("/github/setup"), true);
    assert.equal(isProtectedPagePath("/github/callback"), true);
    assert.equal(isProtectedPagePath("/bounties/new"), true);
    assert.equal(isProtectedPagePath("/board"), false);
    assert.equal(isProtectedPagePath("/about"), false);
    assert.equal(isProtectedPagePath("/roadmap"), false);
    assert.equal(isProtectedPagePath("/signin"), false);
    assert.equal(isProtectedPagePath("/"), false);
    assert.equal(isProtectedPagePath("/webhooks/github"), false);

    assert.equal(isProtectedApiPath("/api/me"), true);
    assert.equal(isProtectedApiPath("/api/github/connect"), true);
    assert.equal(isProtectedApiPath("/api/health"), false);
    assert.equal(isProtectedApiPath("/api/stats"), false);
    assert.equal(isProtectedApiPath("/api/v1/bounties"), false);
    assert.equal(isProtectedApiPath("/api/v1/stats"), false);
    assert.equal(isProtectedApiPath("/api/docs"), false);
    assert.equal(isProtectedApiPath("/mcp"), false);
    assert.equal(isProtectedApiPath("/api/auth/signin"), false);
    assert.equal(isProtectedApiPath("/api/auth/callback/google"), false);

    assert.equal(isProtectedPath("/api/me"), true);
    assert.equal(isProtectedPath("/api/health"), false);
    assert.equal(isProtectedPath("/api/stats"), false);
    assert.equal(isProtectedPath("/api/v1/bounties"), false);
    assert.equal(isProtectedPath("/api/v1/openapi.json"), false);
    assert.equal(isProtectedPath("/api/docs"), false);
    assert.equal(isProtectedPath("/mcp"), false);
  });
});
