import { usdcToAtomic } from "../lib/money";

/**
 * Dedicated soft-delete guard. This is not the amount-edit rule.
 * Amount edits still use `fundingRecorded` / `amountEditRefusal`, which treat
 * any escrow status other than `pending` as funded and then refuse every
 * status except `pending_fund`. Delete does not.
 *
 * Block only while money is still held:
 * - an escrow in funded / settling / settled_partial / refunding whose face
 *   is not covered by confirmed payouts or a recorded refund
 * - an active claim lock (the schema's pending lock; released and consumed do not count)
 * - an allocation or payout still pending or submitted
 *
 * `failed` and `pending` escrows are unfunded. `settled` and `refunded` are finished.
 */
export const DELETE_BLOCK_REASONS = [
  "escrow_holds_funds",
  "active_claim_lock",
  "in_flight_allocation",
] as const;

export type DeleteBlockReason = (typeof DELETE_BLOCK_REASONS)[number];

const HOLDING_ESCROW_STATUSES = new Set(["funded", "settling", "settled_partial", "refunding"]);
const CONFIRMED_PAYOUT_KINDS = new Set(["WINNER_PAYOUT", "POOL_PAYOUT", "FEE_OUT"]);

export type DeleteGuardInput = {
  escrow: {
    status: string;
    amountUsdc: string;
    refundTxHash: string | null;
  } | null;
  contributions: { amountUsdc: string; refundTxHash: string | null }[];
  claimLocks: { status: string }[];
  allocationLegs: { kind: string; amountUsdc: string; status: string }[];
};

const REASON_LABEL: Record<DeleteBlockReason, string> = {
  escrow_holds_funds: "escrow still holds an unrefunded, unpaid remainder",
  active_claim_lock: "an active claim lock is still pending",
  in_flight_allocation: "an allocation or payout is in flight",
};

export function deleteBlockedMessage(reasons: readonly DeleteBlockReason[]): string {
  const why = reasons.map((reason) => REASON_LABEL[reason]).join("; ");
  return `This bounty still has funds in escrow. Refund it before deleting. Blocked by: ${why}.`;
}

function positiveAtomic(amount: string): bigint {
  try {
    const atomic = usdcToAtomic(amount);
    return atomic > BigInt(0) ? atomic : BigInt(0);
  } catch {
    return BigInt(1);
  }
}

/** Face still held on a live escrow, after confirmed payouts and recorded refunds. */
export function escrowHeldRemainderAtomic(input: DeleteGuardInput): bigint {
  const escrow = input.escrow;
  if (!escrow || !HOLDING_ESCROW_STATUSES.has(escrow.status)) return BigInt(0);
  if (escrow.refundTxHash?.trim()) return BigInt(0);
  const face = positiveAtomic(escrow.amountUsdc);
  let covered = BigInt(0);
  for (const leg of input.allocationLegs) {
    if (leg.status !== "confirmed" || !CONFIRMED_PAYOUT_KINDS.has(leg.kind)) continue;
    covered += positiveAtomic(leg.amountUsdc);
  }
  for (const row of input.contributions) {
    if (!row.refundTxHash?.trim()) continue;
    covered += positiveAtomic(row.amountUsdc);
  }
  const remainder = face - covered;
  return remainder > BigInt(0) ? remainder : BigInt(0);
}

export function deleteBlockReasons(input: DeleteGuardInput): DeleteBlockReason[] {
  const reasons: DeleteBlockReason[] = [];
  if (escrowHeldRemainderAtomic(input) > BigInt(0)) reasons.push("escrow_holds_funds");
  if (input.claimLocks.some((lock) => lock.status === "active")) reasons.push("active_claim_lock");
  if (input.allocationLegs.some((leg) => leg.status === "pending" || leg.status === "submitted")) {
    reasons.push("in_flight_allocation");
  }
  return reasons;
}
