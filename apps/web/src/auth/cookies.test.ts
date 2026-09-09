import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sessionCookieFlags,
  sessionCookieName,
  sessionCookieOptions,
  secureAuthCookiesEnabled,
} from "./cookies";

describe("session cookies", () => {
  it("is httpOnly always and Secure only in production", () => {
    assert.equal(secureAuthCookiesEnabled("development"), false);
    assert.equal(secureAuthCookiesEnabled("production"), true);

    const dev = sessionCookieFlags(false);
    assert.equal(dev.httpOnly, true);
    assert.equal(dev.secure, false);
    assert.equal(dev.sameSite, "lax");
    assert.equal(dev.path, "/");

    const prod = sessionCookieFlags(true);
    assert.equal(prod.httpOnly, true);
    assert.equal(prod.secure, true);
    assert.equal(sessionCookieName(true), "__Secure-authjs.session-token");
    assert.equal(sessionCookieName(false), "authjs.session-token");
  });

  it("builds Auth.js sessionToken options from NODE_ENV", () => {
    const prod = sessionCookieOptions("production");
    assert.equal(prod.options.httpOnly, true);
    assert.equal(prod.options.secure, true);
    assert.equal(prod.name.startsWith("__Secure-"), true);
  });
});
