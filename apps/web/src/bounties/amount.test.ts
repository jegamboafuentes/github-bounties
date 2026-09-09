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
});
