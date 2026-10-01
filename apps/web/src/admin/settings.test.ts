import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdminError } from "./errors";
import {
  assertFeeBps,
  assertFeePercent,
  assertPoolBps,
  assertPoolPercent,
  bpsToPercent,
  resolveFeeBps,
  resolvePoolBps,
} from "./settings";

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

  it("shows percent bounds and rejects empty, blank, and NaN before they become 0", () => {
    assert.equal(bpsToPercent(200), "2.00");
    assert.equal(bpsToPercent(1500), "15.00");
    assert.equal(assertFeePercent("2.00"), 200);
    assert.equal(assertPoolPercent("15"), 1500);
    assert.equal(resolveFeeBps({ feePercent: "0" }), 0);
    assert.equal(resolvePoolBps({ poolBps: 1500, poolPercent: "15.00" }), 1500);
    for (const value of ["", "   ", "NaN", "nope", Number.NaN]) {
      assert.throws(
        () => resolveFeeBps({ feePercent: value }),
        (err: unknown) =>
          err instanceof AdminError &&
          err.code === "invalid_fee_bps" &&
          err.message.includes("0.00%") &&
          err.message.includes("10.00%"),
      );
      assert.throws(
        () => resolvePoolBps({ poolPercent: value }),
        (err: unknown) =>
          err instanceof AdminError &&
          err.code === "invalid_pool_bps" &&
          err.message.includes("10.00%") &&
          err.message.includes("20.00%"),
      );
    }
    assert.throws(
      () => resolveFeeBps({ feeBps: Number.NaN }),
      (err: unknown) => err instanceof AdminError && err.code === "invalid_fee_bps",
    );
  });
});
