import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeBountyAmountUsdc } from "./amount";
import { BountyError } from "./errors";

describe("normalizeBountyAmountUsdc", () => {
  it("pads to 6 decimal USDC", () => {
    assert.equal(normalizeBountyAmountUsdc("25"), "25.000000");
    assert.equal(normalizeBountyAmountUsdc("1.5"), "1.500000");
  });

  it("rejects empty, zero, and too many decimals", () => {
    assert.throws(() => normalizeBountyAmountUsdc(""), BountyError);
    assert.throws(() => normalizeBountyAmountUsdc("0"), BountyError);
    assert.throws(() => normalizeBountyAmountUsdc("1.0000001"), BountyError);
  });

  it("allows 1,000,000 USDC and rejects anything above it", () => {
    assert.equal(normalizeBountyAmountUsdc("1000000"), "1000000.000000");
    assert.equal(normalizeBountyAmountUsdc("1000000.000000"), "1000000.000000");
    for (const raw of ["1000001", "1000000000000000"]) {
      assert.throws(() => normalizeBountyAmountUsdc(raw), (err: unknown) => {
        assert.ok(err instanceof BountyError);
        assert.equal(err.code, "invalid_amount");
        assert.match(err.message, /1,000,000 USDC/);
        return true;
      });
    }
  });
});
