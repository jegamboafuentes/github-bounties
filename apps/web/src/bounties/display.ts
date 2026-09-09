import { CLAIM_LOCK_HOURS } from "../lib/constants";
import type { bountyStatusValues } from "../db/schema";

export const LOCK_NOT_MONEY_COPY =
  "Claim-lock is coordination only. It does not move money. Merge is still truth: the winner is the author of the merged pull request that closes the funded issue.";

export const STUB_FUND_COPY =
  "Stub fund (V1-5 will use CDP). This marks the bounty funded without moving USDC.";

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

/** Deterministic UTC deadline for board copy and tests. */
export function formatLockDeadlineUtc(expiresAt: Date): string {
  return `${expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Board caption when an exclusive lock is active. */
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
  return `${hours}h exclusive claim-lock`;
}

export function bountyStatusLabel(status: (typeof bountyStatusValues)[number] | string): string {
  switch (status) {
    case "pending_fund":
      return "Pending fund";
    case "funded":
      return "Funded (open)";
    case "claim_locked":
      return "Claim-locked";
    case "settling":
      return "Settling";
    case "settled":
      return "Settled";
    case "settled_partial":
      return "Settled (partial)";
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
