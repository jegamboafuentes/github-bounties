import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { USDC_BASE_MAINNET, USDC_BASE_SEPOLIA } from "../lib/constants";
import { EscrowError } from "./errors";
import {
  assertFacilitatorSettlementMatches,
  normalizeFundTxHash,
  x402ChainOf,
  type FacilitatorSettlementCheck,
} from "./fund-hash";
import { createCdpRail, createMockRail } from "./rail";

const PAY_TO = "0x00000000000000000000000000000000e5c400";
const AMOUNT = "12000000";

function check(overrides: {
  issued?: Partial<FacilitatorSettlementCheck["issued"]>;
  observed?: Partial<FacilitatorSettlementCheck["observed"]>;
  accepted?: FacilitatorSettlementCheck["observed"]["accepted"];
} = {}): FacilitatorSettlementCheck {
  const issued = {
    network: "base-sepolia",
    payTo: PAY_TO,
    asset: USDC_BASE_SEPOLIA,
    amount: AMOUNT,
    ...overrides.issued,
  };
  const accepted = overrides.accepted === undefined
    ? {
        network: "eip155:84532",
        payTo: PAY_TO,
        asset: USDC_BASE_SEPOLIA,
        amount: AMOUNT,
      }
    : overrides.accepted;
  return {
    bountyId: "bounty-1",
    actorUserId: "user-1",
    requestId: "req-settle",
    action: "lock",
    txHash: "0xabc",
    issued,
    observed: {
      network: "eip155:84532",
      payTo: PAY_TO,
      asset: USDC_BASE_SEPOLIA,
      amount: AMOUNT,
      accepted,
      ...overrides.observed,
    },
  };
}

function moneyResults(lines: string[]): string[] {
  return lines.flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as { event?: string; result?: string };
      return parsed.event === "money_action" && parsed.result ? [parsed.result] : [];
    } catch {
      return [];
    }
  });
}

describe("fund hash case", () => {
  it("normalizes hashes to lowercase and leaves an empty value empty", () => {
    assert.equal(normalizeFundTxHash("  0xAbC  "), "0xabc");
    assert.equal(normalizeFundTxHash(null), "");
    assert.equal(normalizeFundTxHash("mock:0xDEF"), "mock:0xdef");
  });
});

describe("facilitator settlement response", () => {
  it("accepts Base Sepolia aliases and a checksummed payTo", () => {
    assert.equal(x402ChainOf("base-sepolia"), "base-sepolia");
    assert.equal(x402ChainOf("eip155:84532"), "base-sepolia");
    assert.equal(x402ChainOf("base"), "base");
    assert.equal(x402ChainOf("eip155:8453"), "base");
    assert.equal(x402ChainOf("eip155:1"), null);
    assert.doesNotThrow(() =>
      assertFacilitatorSettlementMatches(
        check({
          observed: { payTo: PAY_TO.toUpperCase() },
        }),
      ),
    );
  });

  it("rejects a settle whose network, payTo, asset, or amount is not the requirement we issued", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      assert.throws(
        () => assertFacilitatorSettlementMatches(check({ observed: { network: "eip155:8453" } })),
        (err: unknown) => err instanceof EscrowError && err.code === "x402_settle_mismatch" && err.details?.field === "network",
      );
      assert.throws(
        () =>
          assertFacilitatorSettlementMatches(
            check({
              issued: { network: "base", asset: USDC_BASE_MAINNET },
              observed: {
                network: "base-sepolia",
                asset: USDC_BASE_MAINNET,
                accepted: {
                  network: "eip155:8453",
                  payTo: PAY_TO,
                  asset: USDC_BASE_MAINNET,
                  amount: AMOUNT,
                },
              },
            }),
          ),
        (err: unknown) => err instanceof EscrowError && err.code === "x402_settle_mismatch",
      );
      assert.throws(
        () => assertFacilitatorSettlementMatches(check({ observed: { payTo: "0x1111111111111111111111111111111111111111" } })),
        (err: unknown) => err instanceof EscrowError && err.code === "x402_settle_mismatch" && err.details?.field === "payTo",
      );
      assert.throws(
        () => assertFacilitatorSettlementMatches(check({ observed: { asset: USDC_BASE_MAINNET } })),
        (err: unknown) => err instanceof EscrowError && err.code === "x402_settle_mismatch" && err.details?.field === "asset",
      );
      assert.throws(
        () => assertFacilitatorSettlementMatches(check({ observed: { amount: "1" } })),
        (err: unknown) => err instanceof EscrowError && err.code === "x402_settle_mismatch" && err.details?.field === "amount",
      );
      assert.throws(
        () => assertFacilitatorSettlementMatches(check({ observed: { settledAmount: "1" } })),
        (err: unknown) => err instanceof EscrowError && err.code === "x402_settle_mismatch" && err.details?.field === "settledAmount",
      );
      assert.throws(
        () => assertFacilitatorSettlementMatches(check({ observed: { network: "eip155:1" } })),
        (err: unknown) => err instanceof EscrowError && err.code === "x402_settle_mismatch" && err.details?.field === "network",
      );
      assert.throws(
        () => assertFacilitatorSettlementMatches(check({ accepted: null })),
        (err: unknown) => err instanceof EscrowError && err.code === "x402_settle_mismatch" && err.details?.field === "accepted",
      );
    } finally {
      console.log = original;
    }
    assert.ok(moneyResults(lines).every((result) => result === "x402_settle_mismatch"));
    assert.ok(moneyResults(lines).length >= 7);
  });

  it("rejects a mismatched facilitator response on the rail before any wallet call", async () => {
    const mockRail = createMockRail();
    const locked = await mockRail.lockFace({
      amountAtomic: 1n,
      idempotencyKey: "k",
      fundTxHash: "0xAbC",
    });
    assert.equal(locked.txHash, "0xabc");

    await assert.rejects(
      () =>
        mockRail.lockFace({
          amountAtomic: 1n,
          idempotencyKey: "k2",
          fundTxHash: "0xabc",
          facilitatorSettlement: check({ observed: { network: "eip155:1" } }),
        }),
      (err: unknown) => err instanceof EscrowError && err.code === "x402_settle_mismatch",
    );

    const live = createCdpRail({
      CDP_API_KEY_ID: "test-id",
      CDP_API_KEY_SECRET: "test-secret",
      CDP_WALLET_SECRET: "test-wallet",
      CDP_NETWORK: "base-sepolia",
    });
    await assert.rejects(
      () =>
        live.lockFace({
          amountAtomic: 1n,
          idempotencyKey: "k3",
          fundTxHash: "0xabc",
          verifiedInbound: true,
          facilitatorSettlement: check({ observed: { amount: "1" } }),
        }),
      (err: unknown) => err instanceof EscrowError && err.code === "x402_settle_mismatch",
    );
  });
});
