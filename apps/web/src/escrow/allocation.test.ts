import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitFaceUsdc, splitPostFeePool } from "../lib/money";
import {
  allocationIdempotencyKey,
  attributedFromOutflows,
  confirmedOutflowsFromLegs,
  isExpectedPoolDefer,
  keptPaidAt,
  ledgerUpdatedAt,
  planSettleLegs,
  shouldTransferLeg,
} from "./allocation";
import { moneyIdempotencyKey } from "./idempotency";
import { attributedAtomic } from "./reconcile";

const BOUNTY = "11111111-1111-4111-8111-111111111111";
const WINNER_ADDR = "0x00000000000000000000000000000000h007e4";
const FEE_ADDR = "0x00000000000000000000000000000000fee200";
const ALICE = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";

describe("V2-3 allocation legs (ADR 0003)", () => {
  it("empty-pool regression: no POOL_PAYOUT; winner amount equals V1 post_fee", () => {
    const split = splitPostFeePool("100.000000", 0);
    const v1 = splitFaceUsdc("100.000000");
    assert.equal(split.winnerUsdc, "98.000000");
    assert.equal(split.feeUsdc, "2.000000");
    assert.equal(split.winnerAtomic, v1.hunterAtomic);
    assert.equal(split.poolPaidAtomic, 0n);

    const legs = planSettleLegs({
      bountyId: BOUNTY,
      split,
      winnerAddress: WINNER_ADDR,
      winnerParticipantId: null,
      feeAddress: FEE_ADDR,
      poolMembers: [],
    });
    assert.equal(legs.some((leg) => leg.kind === "POOL_PAYOUT"), false);
    assert.deepEqual(
      legs.map((leg) => leg.kind),
      ["WINNER_PAYOUT", "FEE_OUT"],
    );
    assert.equal(legs[0]?.amountUsdc, v1.hunterUsdc);
    assert.equal(legs[1]?.amountUsdc, v1.feeUsdc);
    assert.equal(legs[0]?.purpose, "hunter");
    assert.equal(legs[1]?.purpose, "fee");
  });

  it("uses 2% face then 85/15 of remainder — not 0.15 × F", () => {
    const split = splitPostFeePool("100.000000", 2);
    assert.equal(split.feeUsdc, "2.000000");
    assert.equal(split.winnerUsdc, "83.300000");
    assert.equal(split.poolTotalUsdc, "14.700000");
    assert.equal(split.eachUsdc, "7.350000");
    assert.notEqual(split.poolTotalUsdc, "15.000000");

    const legs = planSettleLegs({
      bountyId: BOUNTY,
      split,
      winnerAddress: WINNER_ADDR,
      winnerParticipantId: "winner-row",
      feeAddress: FEE_ADDR,
      poolMembers: [
        { id: ALICE, toAddress: "0xalice", userId: ALICE },
        { id: BOB, toAddress: "0xbob", userId: BOB },
      ],
    });
    assert.deepEqual(
      legs.map((leg) => [leg.kind, leg.amountUsdc]),
      [
        ["WINNER_PAYOUT", "83.300000"],
        ["FEE_OUT", "2.000000"],
        ["POOL_PAYOUT", "7.350000"],
        ["POOL_PAYOUT", "7.350000"],
      ],
    );
    const sum = legs.reduce((acc, leg) => acc + leg.amountAtomic, 0n);
    assert.equal(sum, split.faceAtomic);
  });

  it("gives each leg its own idempotency key; winner/fee reuse V1-5 keys", () => {
    const fee = allocationIdempotencyKey(BOUNTY, "FEE_OUT");
    const winner = allocationIdempotencyKey(BOUNTY, "WINNER_PAYOUT");
    const alice = allocationIdempotencyKey(BOUNTY, "POOL_PAYOUT", ALICE);
    const bob = allocationIdempotencyKey(BOUNTY, "POOL_PAYOUT", BOB);
    assert.equal(fee, moneyIdempotencyKey(BOUNTY, "FEE_OUT"));
    assert.equal(winner, moneyIdempotencyKey(BOUNTY, "HUNTER_PAYOUT"));
    assert.notEqual(fee, winner);
    assert.notEqual(alice, bob);
    assert.notEqual(alice, winner);
    assert.match(alice, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("defers unlinked / missing-wallet pool members without dropping the leg", () => {
    const split = splitPostFeePool("100.000000", 2);
    const legs = planSettleLegs({
      bountyId: BOUNTY,
      split,
      winnerAddress: WINNER_ADDR,
      winnerParticipantId: null,
      feeAddress: FEE_ADDR,
      poolMembers: [
        { id: ALICE, toAddress: null, userId: null },
        { id: BOB, toAddress: "0xbob", userId: BOB },
      ],
    });
    const alice = legs.find((leg) => leg.participantId === ALICE);
    const bob = legs.find((leg) => leg.participantId === BOB);
    assert.equal(alice?.deferReason, "hunter_not_linked");
    assert.equal(alice?.amountUsdc, "7.350000");
    assert.equal(bob?.deferReason, null);
    assert.equal(legs.filter((leg) => leg.kind === "POOL_PAYOUT").length, 2);
    const winner = legs.find((leg) => leg.kind === "WINNER_PAYOUT");
    const fee = legs.find((leg) => leg.kind === "FEE_OUT");
    assert.equal(shouldTransferLeg(winner!, "winner_and_fee"), true);
    assert.equal(shouldTransferLeg(fee!, "winner_and_fee"), true);
    assert.equal(shouldTransferLeg(alice!, "winner_and_fee"), false);
    assert.equal(shouldTransferLeg(alice!, "pool_member", ALICE), true);
    assert.equal(shouldTransferLeg(bob!, "pool_member", ALICE), false);
    assert.equal(shouldTransferLeg(alice!, "all"), true);
    assert.equal(isExpectedPoolDefer("missing_payout_address"), true);
    assert.equal(isExpectedPoolDefer("hunter_not_linked"), true);
    assert.equal(isExpectedPoolDefer("rail_failed"), false);
  });

  it("recon: attributed = F − confirmed winner − pool − fee; Settled/Refunded = 0", () => {
    const split = splitPostFeePool("100.000000", 2);
    const partial = confirmedOutflowsFromLegs([
      { kind: "WINNER_PAYOUT", amountUsdc: split.winnerUsdc, txHash: "0xw", status: "confirmed" },
      { kind: "FEE_OUT", amountUsdc: split.feeUsdc, txHash: "0xf", status: "confirmed" },
      { kind: "POOL_PAYOUT", amountUsdc: split.eachUsdc ?? "0", txHash: "0xa", status: "confirmed" },
      { kind: "POOL_PAYOUT", amountUsdc: split.eachUsdc ?? "0", txHash: null, status: "pending" },
    ]);
    assert.equal(partial.winnerAtomic, split.winnerAtomic);
    assert.equal(partial.poolAtomic, split.shareAtomic);
    assert.equal(partial.feeAtomic, split.feeAtomic);
    assert.equal(
      attributedFromOutflows(split.faceAtomic, partial, false),
      split.shareAtomic,
    );
    assert.equal(attributedFromOutflows(split.faceAtomic, partial, true), 0n);

    const settled = attributedAtomic({
      bountyId: "b",
      faceUsdc: "100.000000",
      escrowStatus: "settled",
      fundTxHash: "0xf",
      payoutTxHash: "0xw",
      feeTxHash: "0xfee",
      refundTxHash: null,
      confirmedWinnerAtomic: split.winnerAtomic,
      confirmedPoolAtomic: split.poolPaidAtomic,
      confirmedFeeAtomic: split.feeAtomic,
    });
    assert.equal(settled, 0n);

    const leftover = attributedAtomic({
      bountyId: "b",
      faceUsdc: "100.000000",
      escrowStatus: "settled_partial",
      fundTxHash: "0xf",
      payoutTxHash: "0xw",
      feeTxHash: "0xfee",
      refundTxHash: null,
      confirmedWinnerAtomic: split.winnerAtomic,
      confirmedPoolAtomic: split.shareAtomic,
      confirmedFeeAtomic: split.feeAtomic,
    });
    assert.equal(leftover, split.shareAtomic);
  });
});

describe("per-leg timestamps", () => {
  it("keeps an earlier paid_at when a later leg settles", () => {
    const winnerPaid = new Date("2026-09-25T14:16:05.000Z");
    const poolPaid = new Date("2026-09-25T14:16:19.000Z");
    assert.equal(keptPaidAt(null, winnerPaid).toISOString(), "2026-09-25T14:16:05.000Z");
    assert.equal(keptPaidAt(winnerPaid, poolPaid).toISOString(), "2026-09-25T14:16:05.000Z");
  });

  it("does not let updated_at precede created_at", () => {
    const created = new Date("2026-09-25T14:16:06.000Z");
    const earlier = new Date("2026-09-25T14:16:05.000Z");
    const later = new Date("2026-09-25T14:16:07.000Z");
    assert.equal(ledgerUpdatedAt(created, earlier).toISOString(), created.toISOString());
    assert.equal(ledgerUpdatedAt(created, later).toISOString(), later.toISOString());
    assert.equal(ledgerUpdatedAt(created, created).toISOString(), created.toISOString());
    assert.equal(ledgerUpdatedAt(null, earlier).toISOString(), earlier.toISOString());
  });
});
