import { splitFaceUsdc } from "../lib/money";
import { attributedFromOutflows, type ConfirmedOutflows } from "./allocation";
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
  /** Confirmed V2-3 outflows. When omitted, recon assumes the V1 empty-pool split. */
  confirmedWinnerAtomic?: bigint | null;
  confirmedPoolAtomic?: bigint | null;
  confirmedFeeAtomic?: bigint | null;
};

function confirmedOutflows(row: EscrowReconRow): ConfirmedOutflows | null {
  if (
    row.confirmedWinnerAtomic == null &&
    row.confirmedPoolAtomic == null &&
    row.confirmedFeeAtomic == null
  ) {
    return null;
  }
  return {
    winnerAtomic: row.confirmedWinnerAtomic ?? BigInt(0),
    poolAtomic: row.confirmedPoolAtomic ?? BigInt(0),
    feeAtomic: row.confirmedFeeAtomic ?? BigInt(0),
  };
}

/**
 * Per-bounty attributed USDC still in gb-escrow (ADR 0001 / 0003).
 *
 *   attributed = F − confirmed winner − confirmed pool − confirmed fee − refund
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

  const out = confirmedOutflows(row);
  if (out) {
    if (row.escrowStatus === "settled") {
      return BigInt(0);
    }
    return attributedFromOutflows(split.faceAtomic, out, false);
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
  const out = confirmedOutflows(row);
  const notes: string[] = [
    `bounty=${row.bountyId} escrow=${row.escrowStatus} face=${split.faceUsdc} attributed_atomic=${attributed.toString()}`,
    out
      ? `fee=${split.feeUsdc} winner_confirmed_atomic=${out.winnerAtomic.toString()} pool_confirmed_atomic=${out.poolAtomic.toString()} fee_confirmed_atomic=${out.feeAtomic.toString()} fee_bps=${split.feeBps}`
      : `fee=${split.feeUsdc} hunter=${split.hunterUsdc} fee_bps=${split.feeBps} (settlement only)`,
  ];
  if (isMockTxHash(row.fundTxHash) || isMockTxHash(row.payoutTxHash) || isMockTxHash(row.feeTxHash) || isMockTxHash(row.refundTxHash)) {
    notes.push(
      "rail=mock — hashes are not on-chain. Missing CDP_* (see result.missingEnv). Not a silent wallet-loss: mock is explicit.",
    );
  }
  if (row.escrowStatus === "settled_partial") {
    notes.push(
      "SettledPartial: retry remaining legs only with the same per-leg idempotency keys. Never reverse a confirmed transfer.",
    );
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
