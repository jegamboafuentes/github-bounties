import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FEE_BPS } from "../lib/constants";
import { feeFromFaceUsdc, splitFaceAtomic, splitFaceUsdc } from "../lib/money";

describe("ADR 0001 fee math (2% at settlement)", () => {
  it("uses fee_bps=200 and floor(face * 0.02)", () => {
    assert.equal(FEE_BPS, 200);
    const cases: Array<[bigint, bigint, bigint]> = [
      [1n, 0n, 1n],
      [49n, 0n, 49n],
      [50n, 1n, 49n],
      [1_000_000n, 20_000n, 980_000n],
      [100_000_000n, 2_000_000n, 98_000_000n],
      [1_234_567n, 24_691n, 1_209_876n],
    ];
    for (const [face, fee, hunter] of cases) {
      const split = splitFaceAtomic(face);
      assert.equal(split.feeAtomic, fee, `fee for ${face}`);
      assert.equal(split.hunterAtomic, hunter, `hunter for ${face}`);
      assert.equal(split.feeAtomic + split.hunterAtomic, face);
    }
  });

  it("matches feeFromFaceUsdc and conserves face", () => {
    const split = splitFaceUsdc("100.000000");
    assert.equal(split.feeUsdc, "2.000000");
    assert.equal(split.hunterUsdc, "98.000000");
    assert.equal(feeFromFaceUsdc("100.000000"), "2.000000");
    assert.equal(feeFromFaceUsdc("1.000000"), "0.020000");
    assert.equal(feeFromFaceUsdc("0.010000"), "0.000200");
  });

  it("rejects non-positive face", () => {
    assert.throws(() => splitFaceAtomic(0n), RangeError);
    assert.throws(() => splitFaceAtomic(-1n), RangeError);
  });
});
