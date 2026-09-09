import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isProtectedApiPath, isProtectedPagePath, isProtectedPath } from "./paths";

describe("protected paths", () => {
  it("protects settings and /api/me, not health or auth routes", () => {
    assert.equal(isProtectedPagePath("/settings"), true);
    assert.equal(isProtectedPagePath("/settings/wallet"), true);
    assert.equal(isProtectedPagePath("/signin"), false);
    assert.equal(isProtectedPagePath("/"), false);

    assert.equal(isProtectedApiPath("/api/me"), true);
    assert.equal(isProtectedApiPath("/api/github/connect"), true);
    assert.equal(isProtectedApiPath("/api/health"), false);
    assert.equal(isProtectedApiPath("/api/auth/signin"), false);
    assert.equal(isProtectedApiPath("/api/auth/callback/google"), false);

    assert.equal(isProtectedPath("/api/me"), true);
    assert.equal(isProtectedPath("/api/health"), false);
  });
});
