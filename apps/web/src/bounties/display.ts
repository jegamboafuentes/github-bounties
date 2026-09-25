import { CLAIM_LOCK_HOURS, FEE_BPS, POOL_MAX_PAID } from "../lib/constants";
import { splitFaceUsdc, splitPostFeePool } from "../lib/money";
import type { bountyStatusValues } from "../db/schema";

export const LOCK_NOT_MONEY_COPY =
  "Parallel hunt is coordination only. Optional Working on this does not move money and is not exclusive. Merge is still truth: the winner is the author of the merged pull request that closes the funded issue.";

export const PARALLEL_HUNT_COPY = LOCK_NOT_MONEY_COPY;

export type FundChainDisplayName = "Base" | "Base Sepolia";

export function fundLockCopy(chainName: FundChainDisplayName): string {
  return `Locks face USDC in gb-escrow (CDP server wallet on ${chainName} when CDP_* is set; otherwise a documented mock rail that lists the exact missing env). Prefer x402 exact to gb-escrow, then Lock without pasting a hash. Hosted checkout is disabled. Exclusive claim-lock is retired; Working on this does not move money.`;
}

export function x402ExactFundCopy(chainName: FundChainDisplayName): string {
  return `Connect a ${chainName} wallet, then Pay face F (x402 exact to gb-escrow). Settlement records inbound so Lock needs no explorer hash. Paste-hash Lock is mock/local only. Hosted checkout stays disabled.`;
}

export function fundRailCaption(chainName: FundChainDisplayName): string {
  return `chain base · rail ${chainName} (CDP)`;
}

/** DEV default (Sepolia). Prefer `fundLockCopy(fund.chainName)` on fund/WC paths. */
export const FUND_LOCK_COPY = fundLockCopy("Base Sepolia");

export const HOSTED_CHECKOUT_DISABLED_COPY =
  "Hosted Coinbase checkout is disabled until ADR 0001 confirms settlement.feeAmount / net proceeds equal face. Do not treat a checkout as escrow.";

/** DEV default (Sepolia). Prefer `x402ExactFundCopy(fund.chainName)` on fund/WC paths. */
export const X402_EXACT_FUND_COPY = x402ExactFundCopy("Base Sepolia");

export const CLAIM_PAYOUT_COPY =
  "Eligible winner only: the merged pull request author claims their winner share + the 2% platform fee to the Base wallet saved in Settings. Pool members claim their own frozen shares separately. Missing pool wallets do not block the winner.";

export const POOL_PAYOUT_COPY =
  "Frozen 85/15 of post-fee (ADR 0003). Winner Claim pays winner + fee only. Each pool participant Claims their equal share when they have a Settings payout wallet. Already-paid shares show Paid. Unlinked or wallet-less members stay retryable; their share is not redistributed.";

export const POOL_CLAIM_COPY =
  "Claim your frozen pool share to a bring-your-own Base address. Wallet is required now — not when the winner claimed. Double-claim does not pay twice.";

export const WINNER_PAID_POOL_PENDING_LABEL = "Winner paid — pool pending";

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
      return WINNER_PAID_POOL_PENDING_LABEL;
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
    case "pending":
      return "Claim pending";
    case "rejected":
      return "Rejected";
    case "disputed":
      return "Disputed";
    default:
      return status;
  }
}

export function sharePaidLabel(paid: boolean): string {
  return paid ? "Paid" : "Claim pending";
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
