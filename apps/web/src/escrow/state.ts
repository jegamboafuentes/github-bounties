import { escrowStatusValues } from "../db/schema";

/**
 * Escrow money states on `escrows.status`.
 *
 * Ticket language maps onto the schema (do not rename the enum):
 *   pending  → pending
 *   locked   → funded   (face F held in gb-escrow)
 *   released → settled
 *   refunded → refunded
 */
export type EscrowStatus = (typeof escrowStatusValues)[number];

export const ESCROW_LOCKED: EscrowStatus = "funded";
export const ESCROW_RELEASED: EscrowStatus = "settled";

const ALLOWED: Record<EscrowStatus, readonly EscrowStatus[]> = {
  pending: ["funded", "failed"],
  funded: ["settling", "refunding"],
  settling: ["settled", "settled_partial", "refunding"],
  settled_partial: ["settled", "settled_partial", "settling"],
  refunding: ["refunded"],
  settled: [],
  refunded: [],
  failed: [],
};

export function canTransitionEscrow(from: EscrowStatus, to: EscrowStatus): boolean {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

export function assertEscrowTransition(from: EscrowStatus, to: EscrowStatus): void {
  if (!canTransitionEscrow(from, to)) {
    throw new Error(`illegal escrow transition ${from} → ${to}`);
  }
}

export type MoneyKind = "FUND_IN" | "SWEEP_IN" | "HUNTER_PAYOUT" | "FEE_OUT" | "REFUND_OUT";

/** Bounty statuses that still hold face F in escrow (open or claim-locked). */
export const OPEN_MONEY_BOUNTY_STATUSES = ["funded", "claim_locked"] as const;

export const SETTLEABLE_BOUNTY_STATUSES = [
  "funded",
  "claim_locked",
  "settling",
  "settled_partial",
] as const;

export const REFUNDABLE_BOUNTY_STATUSES = [
  "funded",
  "claim_locked",
  "refunding",
] as const;
