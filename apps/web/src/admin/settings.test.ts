import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdminError } from "./errors";
import { assertFeeBps, assertPoolBps } from "./settings";

describe("platform setting bounds", () => {
  it("accepts 0–1000 fee bps and 1000–2000 pool bps", () => {
    assert.equal(assertFeeBps(0), 0);
    assert.equal(assertFeeBps(200), 200);
    assert.equal(assertFeeBps(1000), 1000);
    assert.equal(assertPoolBps(1000), 1000);
    assert.equal(assertPoolBps(1500), 1500);
    assert.equal(assertPoolBps(2000), 2000);
    assert.throws(() => assertFeeBps(1001), (err: unknown) => err instanceof AdminError && err.code === "invalid_fee_bps");
    assert.throws(() => assertFeeBps(1.5), AdminError);
    assert.throws(() => assertPoolBps(999), (err: unknown) => err instanceof AdminError && err.code === "invalid_pool_bps");
    assert.throws(() => assertPoolBps(2001), AdminError);
  });
});
