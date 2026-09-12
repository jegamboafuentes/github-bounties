import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FUND_AMOUNT_PRESETS_USDC,
  fundPresetLabel,
  fundPresetMatchesAmount,
  isFundAmountPreset,
} from "./fund-presets";

describe("fund amount presets", () => {
  it("is 1 / 5 / 10 / 50 / 100 USDC plus custom (not on this list)", () => {
    assert.deepEqual([...FUND_AMOUNT_PRESETS_USDC], [1, 5, 10, 50, 100]);
    assert.equal(isFundAmountPreset(10), true);
    assert.equal(isFundAmountPreset(25), false);
    assert.equal(fundPresetLabel(5), "$5");
  });

  it("highlights a chip when the typed amount is that face", () => {
    assert.equal(fundPresetMatchesAmount(10, "10"), true);
    assert.equal(fundPresetMatchesAmount(10, "10.0"), true);
    assert.equal(fundPresetMatchesAmount(10, "10.00"), true);
    assert.equal(fundPresetMatchesAmount(10, "25"), false);
    assert.equal(fundPresetMatchesAmount(10, ""), false);
    assert.equal(fundPresetMatchesAmount(1, "1.000001"), false);
  });
});
