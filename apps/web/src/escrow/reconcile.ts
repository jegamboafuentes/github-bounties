import { splitFaceUsdc } from "../lib/money";
import { isMockTxHash } from "./idempotency";
import type { EscrowStatus } from "./state";

export type EscrowReconRow = {
  bountyId: string;
  faceUsdc: string;
  escrowStatus: EscrowStatus;
  fundTxHash: string | null;
  payoutTxHash: string | null;
  feeTxHash: string | null;
  refundTxHash: string | null;
};

/**
 * Per-bounty attributed USDC still in gb-escrow (ADR 0001 invariant).
 *
 *   attributed = FUND_IN − HUNTER_PAYOUT − FEE_OUT − REFUND_OUT
 *
 * Terminal Settled / Refunded → 0. Open / claim-locked → face F.
 * SettledPartial → remainder after confirmed legs only.
 */
export function attributedAtomic(row: EscrowReconRow): bigint {
  const split = splitFaceUsdc(row.faceUsdc);
  if (row.escrowStatus === "pending" || row.escrowStatus === "failed") {
    return BigInt(0);
  }
  if (row.escrowStatus === "refunded" || Boolean(row.refundTxHash)) {
    return BigInt(0);
  }
  if (row.escrowStatus === "settled" && row.payoutTxHash && (row.feeTxHash || split.feeAtomic === BigInt(0))) {
    return BigInt(0);
  }
  let attributed = split.faceAtomic;
  if (row.payoutTxHash) attributed -= split.hunterAtomic;
  if (row.feeTxHash) attributed -= split.feeAtomic;
  return attributed;
}

export function reconcileBountyNotes(row: EscrowReconRow): string[] {
  const split = splitFaceUsdc(row.faceUsdc);
  const attributed = attributedAtomic(row);
  const notes: string[] = [
    `bounty=${row.bountyId} escrow=${row.escrowStatus} face=${split.faceUsdc} attributed_atomic=${attributed.toString()}`,
    `fee=${split.feeUsdc} hunter=${split.hunterUsdc} fee_bps=${split.feeBps} (settlement only)`,
  ];
  if (isMockTxHash(row.fundTxHash) || isMockTxHash(row.payoutTxHash) || isMockTxHash(row.feeTxHash) || isMockTxHash(row.refundTxHash)) {
    notes.push(
      "rail=mock — hashes are not on-chain. Missing CDP_* (see result.missingEnv). Not a silent wallet-loss: mock is explicit.",
    );
  }
  if (row.escrowStatus === "settled_partial") {
    notes.push("SettledPartial: retry FEE_OUT only with the same fee idempotency key. Never reverse a confirmed hunter payout.");
  }
  if (row.escrowStatus === "funded" && attributed !== split.faceAtomic) {
    notes.push("DRIFT: open bounty attributed ≠ face. Freeze new settlements and recon gb-escrow.");
  }
  if ((row.escrowStatus === "settled" || row.escrowStatus === "refunded") && attributed !== BigInt(0)) {
    notes.push("DRIFT: terminal bounty still has attributed escrow. Alarm.");
  }
  notes.push(
    "Wallet recon: sum(open attributed) == on-chain gb-escrow USDC (allow in-flight submitted rows). Nightly job — V1-5 hook only.",
  );
  notes.push(
    "Hosted checkout is not an escrow hold (ADR 0001 open Q: settlement.feeAmount).",
  );
  return notes;
}

export function sumAttributedAtomic(rows: EscrowReconRow[]): bigint {
  return rows.reduce((acc, row) => acc + attributedAtomic(row), BigInt(0));
}
