import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { USDC_BASE_MAINNET, USDC_BASE_SEPOLIA } from "../lib/constants";
import { EscrowError } from "./errors";
import { configuredUsdcContract } from "./rail";
import {
  assertDestinationEquals,
  payerDistinctFromEscrow,
  releaseUsdcIfMatch,
  sameStoredDestination,
} from "./destination-guard";

const HUNTER = "0x1111111111111111111111111111111111111111";
const HUNTER_UPPER = "0x1111111111111111111111111111111111111111".toUpperCase();
const ATTACKER = "0x9999999999999999999999999999999999999999";
const ESCROW = "0x2222222222222222222222222222222222222222";

describe("destination guard", () => {
  it("treats checksum case as the same stored address and rejects a lookalike", () => {
    assert.equal(sameStoredDestination(`  ${HUNTER_UPPER} `, HUNTER), true);
    assert.equal(sameStoredDestination(ATTACKER, HUNTER), false);
    assert.equal(payerDistinctFromEscrow(ESCROW, ESCROW), null);
    assert.equal(payerDistinctFromEscrow(HUNTER, ESCROW), HUNTER);
  });

  it("blocks a mismatched transfer and does not call the rail", async () => {
    let transfers = 0;
    const logs: string[] = [];
    const original = console.error;
    console.error = (line?: unknown) => {
      logs.push(String(line));
    };
    try {
      await assert.rejects(
        () =>
          releaseUsdcIfMatch({
            to: ATTACKER,
            readStored: async () => HUNTER,
            transfer: async () => {
              transfers += 1;
              return { txHash: "mock:should-not-send" };
            },
          }),
        (err: unknown) => err instanceof EscrowError && err.code === "destination_mismatch",
      );
    } finally {
      console.error = original;
    }
    assert.equal(transfers, 0);
    assert.ok(logs.some((line) => line.includes("destination_mismatch")));
    assert.throws(
      () => assertDestinationEquals(ATTACKER, HUNTER),
      (err: unknown) => err instanceof EscrowError && err.code === "destination_mismatch",
    );
  });

  it("sends only the env USDC contract for the rail network", () => {
    assert.equal(configuredUsdcContract("base-sepolia"), USDC_BASE_SEPOLIA);
    assert.equal(configuredUsdcContract("base"), USDC_BASE_MAINNET);
    assert.equal(configuredUsdcContract("eip155:8453"), USDC_BASE_MAINNET);
  });
});
