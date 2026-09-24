import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alreadyPaidAtomic,
  fundHashIsVerified,
  verifiedInflowAtomic,
  verifiedTopUpHashes,
  withVerifiedTopUpHash,
} from "./payout-guard";

describe("payout guard verified inflows", () => {
  it("counts mock and x402 hashes and ignores a live pasted hash", () => {
    assert.equal(fundHashIsVerified({ hash: "mock:0x1", railMode: "cdp" }), true);
    assert.equal(
      fundHashIsVerified({
        hash: "0xlock",
        railMode: "cdp",
        x402PaymentId: "x402:0xlock",
        escrowFundTxHash: "0xlock",
      }),
      true,
    );
    assert.equal(
      fundHashIsVerified({
        hash: "0xtop",
        railMode: "cdp",
        x402PaymentId: withVerifiedTopUpHash("x402:0xlock", "0xtop"),
        escrowFundTxHash: "0xlock",
      }),
      true,
    );
    assert.equal(
      fundHashIsVerified({
        hash: "0xfake",
        railMode: "cdp",
        x402PaymentId: "x402:0xlock",
        escrowFundTxHash: "0xlock",
      }),
      false,
    );
    assert.deepEqual(verifiedTopUpHashes("x402:0xlock\nx402-topup:0xtop"), ["0xtop"]);

    const inflow = verifiedInflowAtomic({
      railMode: "cdp",
      escrow: {
        amountUsdc: "30.000000",
        fundTxHash: "0xlock",
        x402PaymentId: withVerifiedTopUpHash("x402:0xlock", "0xtop"),
      },
      contributions: [
        { amountUsdc: "10.000000", fundTxHash: "0xlock" },
        { amountUsdc: "5.000000", fundTxHash: "0xtop" },
        { amountUsdc: "15.000000", fundTxHash: "0xfake" },
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
});
