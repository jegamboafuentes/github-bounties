import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientIpFromForwardedFor } from "./client-ip";
import { createRateLimiter, rateLimitHeaders } from "./rate-limit";

describe("public rate limit", () => {
  it("allows 60 requests per minute per key and then asks the caller to wait", () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ now: () => now, limit: 60, windowMs: 60_000 });
    for (let i = 0; i < 60; i += 1) {
      const decision = limiter.check("203.0.113.8");
      assert.equal(decision.allowed, true);
      assert.equal(decision.remaining, 59 - i);
    }
    const blocked = limiter.check("203.0.113.8");
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.equal(blocked.retryAfterSeconds, 60);
    const headers = rateLimitHeaders(blocked, now);
    assert.equal(headers["RateLimit-Limit"], "60");
    assert.equal(headers["RateLimit-Remaining"], "0");
    assert.equal(headers["RateLimit-Reset"], "60");

    const other = limiter.check("203.0.113.9");
    assert.equal(other.allowed, true);

    now += 60_000;
    const again = limiter.check("203.0.113.8");
    assert.equal(again.allowed, true);
    assert.equal(again.remaining, 59);
  });

  it("uses the last X-Forwarded-For hop, which Cloud Run appends", () => {
    assert.equal(clientIpFromForwardedFor("1.1.1.1, 203.0.113.50"), "203.0.113.50");
    assert.equal(clientIpFromForwardedFor(" 203.0.113.7 "), "203.0.113.7");
    assert.equal(clientIpFromForwardedFor(null), "unknown");
    assert.equal(clientIpFromForwardedFor(" , "), "unknown");
  });
});
