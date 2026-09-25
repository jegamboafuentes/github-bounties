import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alreadyPaidAtomic,
  fundHashIsVerified,
  isPlaceholderFundHash,
  logInsufficientBountyFunds,
  verifiedInflowAtomic,
  verifiedTopUpHashes,
  withVerifiedTopUpHash,
} from "./payout-guard";

const LOCK = `0x${"11".repeat(32)}`;
const TOP = `0x${"22".repeat(32)}`;
const FAKE = `0x${"33".repeat(32)}`;

describe("payout guard verified inflows", () => {
  it("counts mock and x402 hashes and ignores a live pasted hash", () => {
    assert.equal(fundHashIsVerified({ hash: "mock:0x1", railMode: "cdp" }), true);
    assert.equal(
      fundHashIsVerified({
        hash: LOCK,
        railMode: "cdp",
        x402PaymentId: `x402:${LOCK}`,
        escrowFundTxHash: LOCK,
      }),
      true,
    );
    assert.equal(
      fundHashIsVerified({
        hash: TOP,
        railMode: "cdp",
        x402PaymentId: withVerifiedTopUpHash(`x402:${LOCK}`, TOP),
        escrowFundTxHash: LOCK,
      }),
      true,
    );
    assert.equal(
      fundHashIsVerified({
        hash: FAKE,
        railMode: "cdp",
        x402PaymentId: `x402:${LOCK}`,
        escrowFundTxHash: LOCK,
      }),
      false,
    );
    assert.deepEqual(verifiedTopUpHashes(`x402:${LOCK}\nx402-topup:${TOP}`), [TOP]);

    const inflow = verifiedInflowAtomic({
      railMode: "cdp",
      escrow: {
        amountUsdc: "30.000000",
        fundTxHash: LOCK,
        x402PaymentId: withVerifiedTopUpHash(`x402:${LOCK}`, TOP),
      },
      contributions: [
        { amountUsdc: "10.000000", fundTxHash: LOCK },
        { amountUsdc: "5.000000", fundTxHash: TOP },
        { amountUsdc: "15.000000", fundTxHash: FAKE },
      ],
    });
    assert.equal(inflow, 15_000_000n);

    const paid = alreadyPaidAtomic({
      legs: [
        { kind: "WINNER_PAYOUT", amountUsdc: "8.000000", txHash: "0xp", status: "confirmed" },
        { kind: "FEE_OUT", amountUsdc: "2.000000", txHash: null, status: "pending" },
      ],
      refundedContributions: [{ amountUsdc: "1.000000", refundTxHash: "0xr" }],
    });
    assert.equal(paid, 9_000_000n);
    assert.equal(inflow - paid < 7_000_000n, true);
    assert.equal(inflow - paid < 6_000_000n, false);
  });

  it("on the mock rail counts recorded contributions, not an inflated face with no row", () => {
    const inflow = verifiedInflowAtomic({
      railMode: "mock",
      escrow: {
        amountUsdc: "1000.000000",
        fundTxHash: "mock:0xfund",
        x402PaymentId: null,
      },
      contributions: [{ amountUsdc: "10.000000", fundTxHash: "mock:0xfund" }],
    });
    assert.equal(inflow, 10_000_000n);
  });

  it("never counts placeholder or pasted hashes on the live rail", () => {
    assert.equal(isPlaceholderFundHash("lock:abc"), true);
    assert.equal(isPlaceholderFundHash("legacy-fund:abc"), true);
    assert.equal(isPlaceholderFundHash("not-a-tx"), true);
    assert.equal(isPlaceholderFundHash("mock:0x1"), false);
    assert.equal(
      fundHashIsVerified({
        hash: "lock:abc",
        railMode: "cdp",
        x402PaymentId: "x402:lock:abc",
        escrowFundTxHash: "lock:abc",
      }),
      false,
    );
    assert.equal(
      fundHashIsVerified({
        hash: "0xlock",
        railMode: "cdp",
        x402PaymentId: "x402:0xlock",
        escrowFundTxHash: "0xlock",
      }),
      false,
    );
  });

  it("does not let a top-up line unlock a different lock hash", () => {
    const paymentId = withVerifiedTopUpHash(null, TOP);
    assert.equal(
      fundHashIsVerified({
        hash: LOCK,
        railMode: "cdp",
        x402PaymentId: paymentId,
        escrowFundTxHash: LOCK,
      }),
      false,
    );
    assert.equal(
      fundHashIsVerified({
        hash: TOP,
        railMode: "cdp",
        x402PaymentId: paymentId,
        escrowFundTxHash: LOCK,
      }),
      true,
    );
  });

  it("logs insufficient_bounty_funds at ERROR", () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      logInsufficientBountyFunds({ bountyId: "b99a", verifiedAtomic: "1000000" });
    } finally {
      console.error = original;
    }
    const parsed = JSON.parse(lines[0] ?? "{}") as { severity?: string; event?: string };
    assert.equal(parsed.severity, "ERROR");
    assert.equal(parsed.event, "insufficient_bounty_funds");
  });
});
