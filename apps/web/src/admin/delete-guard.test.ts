import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deleteBlockReasons, type DeleteGuardInput } from "./delete-guard";

function facts(patch: Partial<DeleteGuardInput> = {}): DeleteGuardInput {
  return {
    escrow: { status: "pending", amountUsdc: "10.000000", refundTxHash: null },
    contributions: [],
    claimLocks: [],
    allocationLegs: [],
    ...patch,
  };
}

describe("delete guard", () => {
  it("allows never-funded, failed, cancelled, and settled shapes", () => {
    assert.deepEqual(deleteBlockReasons(facts()), []);
    assert.deepEqual(deleteBlockReasons(facts({ escrow: null })), []);
    assert.deepEqual(
      deleteBlockReasons(facts({ escrow: { status: "failed", amountUsdc: "10.000000", refundTxHash: null } })),
      [],
    );
    assert.deepEqual(
      deleteBlockReasons(facts({ escrow: { status: "settled", amountUsdc: "10.000000", refundTxHash: null } })),
      [],
    );
    assert.deepEqual(
      deleteBlockReasons(facts({ escrow: { status: "refunded", amountUsdc: "10.000000", refundTxHash: "0xabc" } })),
      [],
    );
    assert.deepEqual(
      deleteBlockReasons(
        facts({
          claimLocks: [{ status: "released" }, { status: "consumed" }],
          allocationLegs: [{ kind: "WINNER_PAYOUT", amountUsdc: "9.800000", status: "confirmed" }],
        }),
      ),
      [],
    );
  });

  it("blocks held escrow, an active claim lock, and an in-flight allocation", () => {
    assert.deepEqual(
      deleteBlockReasons(facts({ escrow: { status: "funded", amountUsdc: "10.000000", refundTxHash: null } })),
      ["escrow_holds_funds"],
    );
    assert.deepEqual(
      deleteBlockReasons(
        facts({
          escrow: { status: "funded", amountUsdc: "10.000000", refundTxHash: "0xrefund" },
          claimLocks: [{ status: "active" }],
          allocationLegs: [{ kind: "WINNER_PAYOUT", amountUsdc: "9.800000", status: "pending" }],
        }),
      ),
      ["active_claim_lock", "in_flight_allocation"],
    );
    assert.deepEqual(
      deleteBlockReasons(
        facts({
          escrow: { status: "settling", amountUsdc: "10.000000", refundTxHash: null },
          allocationLegs: [{ kind: "FEE_OUT", amountUsdc: "0.200000", status: "submitted" }],
        }),
      ),
      ["escrow_holds_funds", "in_flight_allocation"],
    );
  });
});
