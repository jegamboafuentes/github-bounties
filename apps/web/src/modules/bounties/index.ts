/**
 * Bounties module — post from issue URL, board, escrow fund-lock, 72h claim-lock.
 * Claim-lock is coordination only. Merge is still truth (V1-3 eligible Claim path).
 */
export const bountiesModule = {
  name: "bounties" as const,
  wired: true,
  nextTicket: "V2",
  notes:
    "Create from GitHub issue URL, board + filters, escrow fund-lock, exclusive 72h claim-lock, hunter claim payout. Lock ≠ money.",
};

export type BountiesModule = typeof bountiesModule;
