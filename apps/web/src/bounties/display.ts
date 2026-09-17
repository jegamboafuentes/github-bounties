import { CLAIM_LOCK_HOURS, FEE_BPS, POOL_MAX_PAID } from "../lib/constants";
import { splitFaceUsdc, splitPostFeePool } from "../lib/money";
import type { bountyStatusValues } from "../db/schema";

export const LOCK_NOT_MONEY_COPY =
  "Parallel hunt is coordination only. Optional Working on this does not move money and is not exclusive. Merge is still truth: the winner is the author of the merged pull request that closes the funded issue.";

export const PARALLEL_HUNT_COPY = LOCK_NOT_MONEY_COPY;

export const FUND_LOCK_COPY =
  "Locks face USDC in gb-escrow (CDP server wallet on Base Sepolia when CDP_* is set; otherwise a documented mock rail that lists the exact missing env). Prefer x402 exact to gb-escrow, then Lock without pasting a hash. Hosted checkout is disabled. Exclusive claim-lock is retired; Working on this does not move money.";

export const HOSTED_CHECKOUT_DISABLED_COPY =
  "Hosted Coinbase checkout is disabled until ADR 0001 confirms settlement.feeAmount / net proceeds equal face. Do not treat a checkout as escrow.";

export const X402_EXACT_FUND_COPY =
  "Connect a Base Sepolia wallet, then Pay face F (x402 exact to gb-escrow). Settlement records inbound so Lock needs no explorer hash. Advanced paste-hash remains a fallback. Hosted checkout stays disabled.";

export const CLAIM_PAYOUT_COPY =
  "Eligible winner only: the merged pull request author claims their share to a bring-your-own Base address. Pool members are paid to wallets already saved in Settings when settle runs. Poster and the board then see completed (paid).";

export const POOL_PAYOUT_COPY =
  "Winner Claim still uses a BYO Base address on this form. Pool members are paid to the Base address saved in Settings when the winner (or poster) settles — settle pays wallets that already exist. Unlinked or wallet-less members stay retryable; their share is not redistributed.";

export const ELIGIBILITY_FREEZE_COPY =
  "Eligibility freezes at the winning merge. Rows below may still be unfrozen candidates.";

export const WORKING_ON_THIS_COPY =
  "Optional, non-exclusive signal. Many hunters can work the same bounty. It does not change eligibility or money.";

export type BoardLockView = {
  hunterLabel: string;
  expiresAt: Date;
};

export function hunterLabel(args: {
  githubLogin?: string | null;
  displayName?: string | null;
}): string {
  const login = args.githubLogin?.trim();
  if (login) return login;
  const name = args.displayName?.trim();
  if (name) return name;
  return "someone";
}

/** Deterministic UTC deadline for leftover V1 lock tests. */
export function formatLockDeadlineUtc(expiresAt: Date): string {
  return `${expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Historical V1 exclusive-lock caption. V2-4 board/detail must not render this.
 */
export function claimedByUntilLabel(lock: BoardLockView): string {
  return `Claimed by ${lock.hunterLabel} until ${formatLockDeadlineUtc(lock.expiresAt)}`;
}

export function isActiveClaimLock(
  lock: { status: string; expiresAt: Date } | null | undefined,
  now: Date = new Date(),
): boolean {
  return Boolean(lock && lock.status === "active" && lock.expiresAt.getTime() > now.getTime());
}

export function claimLockHoursLabel(hours = CLAIM_LOCK_HOURS): string {
  return `${hours}h exclusive claim-lock (retired)`;
}

export function overflowNotPaidLabel(
  overflowCount: number,
  cap = POOL_MAX_PAID,
): string {
  if (overflowCount <= 0) return "";
  return `+${overflowCount} not paid, cap ${cap}`;
}

export function unlinkedPoolMemberCaption(login: string): string {
  return `${login} must Connect GitHub as that login before pool payout.`;
}

export function workingOnThisCaption(signals: { hunterLabel: string }[]): string {
  if (signals.length === 0) return "";
  if (signals.length === 1) return `${signals[0]?.hunterLabel} is working on this`;
  const names = signals.map((row) => row.hunterLabel).join(", ");
  return `${signals.length} hunters working on this: ${names}`;
}

export function bountyStatusLabel(status: (typeof bountyStatusValues)[number] | string): string {
  switch (status) {
    case "pending_fund":
      return "Pending fund";
    case "funded":
      return "Funded (open)";
    case "claim_locked":
      return "Funded (open)";
    case "settling":
      return "Settling";
    case "settled":
      return "Completed (paid)";
    case "settled_partial":
      return "Paid (partial)";
    case "refunding":
      return "Refunding";
    case "refunded":
      return "Refunded";
    case "void":
      return "Void";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
    default:
      return status;
  }
}

export function claimStatusLabel(status: string): string {
  switch (status) {
    case "eligible":
      return "Eligible";
    case "paid":
      return "Paid";
    case "rejected":
      return "Rejected";
    case "disputed":
      return "Disputed";
    default:
      return status;
  }
}

/** Trim trailing zeros for UI amounts. */
export function formatUsdc(value: string): string {
  if (!value.includes(".")) return value || "0";
  return value.replace(/\.?0+$/, "") || "0";
}

export function payoutBreakdown(faceUsdc: string) {
  const split = splitFaceUsdc(faceUsdc);
  return {
    faceUsdc: split.faceUsdc,
    feeUsdc: split.feeUsdc,
    hunterUsdc: split.hunterUsdc,
    feeBps: split.feeBps,
    feePercent: split.feeBps / 100,
  };
}

/** ADR 0003 face / fee / winner / pool breakdown for the bounty page. */
export function poolPayoutBreakdown(faceUsdc: string, eligibleCount: number) {
  const split = splitPostFeePool(faceUsdc, eligibleCount);
  return {
    faceUsdc: split.faceUsdc,
    feeUsdc: split.feeUsdc,
    winnerUsdc: split.winnerUsdc,
    poolTotalUsdc: split.poolTotalUsdc,
    eachUsdc: split.eachUsdc,
    hunterUsdc: split.winnerUsdc,
    feeBps: split.feeBps,
    feePercent: split.feeBps / 100,
    eligibleCount: split.eligibleCount,
    emptyPool: split.eligibleCount === 0,
  };
}

export function payoutCaption(payout: { status: string; hunterLabel: string }): string {
  if (payout.status === "paid") {
    return `Paid to ${payout.hunterLabel}`;
  }
  if (payout.status === "eligible") {
    return `Payout eligible — ${payout.hunterLabel} can claim`;
  }
  return claimStatusLabel(payout.status);
}

export function feeBpsLabel(feeBps = FEE_BPS): string {
  return `${feeBps / 100}% platform fee`;
}
