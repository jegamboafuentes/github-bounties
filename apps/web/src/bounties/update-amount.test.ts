import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BountyError } from "./errors";
import {
  amountEditRefusal,
  assertNewBountyAmount,
  bountyAmountEditBlocked,
  type AmountEditFunding,
} from "./update-amount";

function funding(partial: Partial<AmountEditFunding> = {}): AmountEditFunding {
  return {
    bountyStatus: "pending_fund",
    escrow: {
      status: "pending",
      amountUsdc: "10.000000",
      fundTxHash: null,
      x402PaymentId: null,
    },
    contributions: [],
    allocationLegs: [],
    railMode: "mock",
    ...partial,
  };
}

describe("assertNewBountyAmount", () => {
  it("uses the create amount rules and requires a real change", () => {
    assert.equal(assertNewBountyAmount("10.000000", "25"), "25.000000");
    assert.equal(assertNewBountyAmount("10.000000", "1.5"), "1.500000");
    assert.equal(assertNewBountyAmount("10.000000", "0.000001"), "0.000001");
  });

  it("rejects a face above 1,000,000 USDC before it can reach Postgres", () => {
    assert.equal(assertNewBountyAmount("10.000000", "1000000"), "1000000.000000");
    for (const raw of ["1000001", "1000000000000000"]) {
      assert.throws(() => assertNewBountyAmount("10.000000", raw), (err: unknown) => {
        assert.ok(err instanceof BountyError);
        assert.equal(err.code, "invalid_amount");
        assert.match(err.message, /1,000,000 USDC/);
        return true;
      });
    }
  });

  it("rejects empty, zero, negative, and more than 6 decimals", () => {
    for (const raw of ["", "0", "0.000000", "-1", "1.0000001", "nope"]) {
      assert.throws(() => assertNewBountyAmount("10.000000", raw), (err: unknown) => {
        assert.ok(err instanceof BountyError);
        assert.equal(err.code, "invalid_amount");
        return true;
      });
    }
  });

  it("rejects a no-op after normalization", () => {
    assert.throws(() => assertNewBountyAmount("10.000000", "10"), (err: unknown) => {
      assert.ok(err instanceof BountyError);
      assert.equal(err.code, "amount_unchanged");
      assert.match(err.message, /10\.000000/);
      return true;
    });
    assert.throws(() => assertNewBountyAmount("1.500000", "1.50"), (err: unknown) => {
      assert.ok(err instanceof BountyError);
      assert.equal(err.code, "amount_unchanged");
      return true;
    });
  });
});

describe("amountEditRefusal", () => {
  it("returns not_editable for cancelled and settled bounties that were never funded", () => {
    for (const bountyStatus of ["cancelled", "settled", "expired", "void", "refunded"]) {
      assert.equal(amountEditRefusal(funding({ bountyStatus })), "not_editable", bountyStatus);
    }
  });

  it("returns has_funds when money is recorded, including a terminal status", () => {
    assert.equal(
      amountEditRefusal(
        funding({
          bountyStatus: "settled",
          escrow: { status: "settled", amountUsdc: "10.000000", fundTxHash: "0xabc", x402PaymentId: null },
        }),
      ),
      "has_funds",
    );
    assert.equal(
      amountEditRefusal(
        funding({
          bountyStatus: "cancelled",
          escrow: { status: "refunded", amountUsdc: "10.000000", fundTxHash: "0xabc", x402PaymentId: null },
        }),
      ),
      "has_funds",
    );
    assert.equal(amountEditRefusal(funding({ escrow: null })), "has_funds");
    assert.equal(amountEditRefusal(funding()), "ok");
  });
});

describe("bountyAmountEditBlocked", () => {
  it("allows an open unfunded bounty with a pending escrow and no inbound", () => {
    assert.equal(bountyAmountEditBlocked(funding()), false);
  });

  it("refuses funded, in-flight, and non-pending statuses", () => {
    for (const bountyStatus of ["funded", "claim_locked", "settling", "refunding", "cancelled", "settled"]) {
      assert.equal(bountyAmountEditBlocked(funding({ bountyStatus })), true, bountyStatus);
    }
    assert.equal(
      bountyAmountEditBlocked(
        funding({
          escrow: { status: "funded", amountUsdc: "10.000000", fundTxHash: null, x402PaymentId: null },
        }),
      ),
      true,
    );
    assert.equal(bountyAmountEditBlocked(funding({ escrow: null })), true);
  });

  it("refuses a recorded x402 lock, fund hash, contribution, or in-flight leg", () => {
    assert.equal(
      bountyAmountEditBlocked(
        funding({
          escrow: {
            status: "pending",
            amountUsdc: "10.000000",
            fundTxHash: "0xabc",
            x402PaymentId: null,
          },
        }),
      ),
      true,
    );
    assert.equal(
      bountyAmountEditBlocked(
        funding({
          escrow: {
            status: "pending",
            amountUsdc: "10.000000",
            fundTxHash: null,
            x402PaymentId: "x402:pending",
          },
        }),
      ),
      true,
    );
    assert.equal(
      bountyAmountEditBlocked(
        funding({ contributions: [{ amountUsdc: "10.000000", fundTxHash: "0xabc" }] }),
      ),
      true,
    );
    assert.equal(
      bountyAmountEditBlocked(
        funding({
          allocationLegs: [
            { kind: "WINNER_PAYOUT", amountUsdc: "1.000000", txHash: null, status: "pending" },
          ],
        }),
      ),
      true,
    );
  });
});
