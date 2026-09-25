import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDisplayName, walletPatchFieldNames, DisplayNameError } from "./settings";

describe("display name", () => {
  it("trims, collapses spaces, and keeps letters, punctuation, and emoji", () => {
    assert.equal(parseDisplayName("  Ada   Lovelace  "), "Ada Lovelace");
    assert.equal(parseDisplayName("山田 太郎"), "山田 太郎");
    assert.equal(parseDisplayName("Ada 😀"), "Ada 😀");
    assert.equal(parseDisplayName("A".repeat(80)).length, 80);
  });

  it("rejects empty, over-long, control, angle-bracket, and address values", () => {
    assert.throws(() => parseDisplayName("   "), DisplayNameError);
    assert.throws(() => parseDisplayName("A".repeat(81)), DisplayNameError);
    assert.throws(() => parseDisplayName("Ada\nLovelace"), /control characters/);
    assert.throws(() => parseDisplayName("Ada <script>"), /angle brackets/);
    assert.throws(() => parseDisplayName(`Ada 0x${"ab".repeat(20)}`), /wallet address/);
    assert.throws(() => parseDisplayName(12), DisplayNameError);
  });
});

describe("wallet patch fields", () => {
  it("finds wallet and payout keys anywhere in the body and ignores display name", () => {
    assert.deepEqual(walletPatchFieldNames({ displayName: "Ada" }), []);
    assert.deepEqual(walletPatchFieldNames({ displayName: "Ada", walletAddress: "0xabc" }), ["walletAddress"]);
    assert.deepEqual(
      walletPatchFieldNames({ email: { payout_address: "0xabc", bountyFunded: false } }),
      ["payout_address"],
    );
    assert.deepEqual(walletPatchFieldNames({ PayTo: "0xabc" }), ["PayTo"]);
    assert.deepEqual(walletPatchFieldNames(null), []);
  });
});
