import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INVALID_BASE_ADDRESS_MESSAGE, isBaseAddress, normalizeBaseAddress } from "./address";

const VALID = "0x1111111111111111111111111111111111111111";
const CHECKSUM = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

describe("Base payout address", () => {
  it("accepts 0x + 40 hex and preserves checksum casing", () => {
    assert.equal(isBaseAddress(VALID), true);
    assert.equal(isBaseAddress(CHECKSUM), true);
    assert.equal(normalizeBaseAddress(`  ${CHECKSUM}  `), CHECKSUM);
  });

  it("rejects empty, ENS, short, zero, and non-hex", () => {
    for (const bad of [
      "",
      "   ",
      "alice.eth",
      "0x1",
      "0x0000000000000000000000000000000000000000",
      "0x00000000000000000000000000000000h007e4",
      "1111111111111111111111111111111111111111",
      "0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    ]) {
      assert.equal(isBaseAddress(bad), false, bad);
      assert.throws(() => normalizeBaseAddress(bad), (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, INVALID_BASE_ADDRESS_MESSAGE);
        return true;
      });
    }
  });
});
