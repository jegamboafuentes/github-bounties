/**
 * Bounties module — V1-4 post from issue URL, board, stub fund, 72h claim-lock.
 * Lock is coordination only. Merge is still truth (V1-3 eligible Claim path).
 */
export const bountiesModule = {
  name: "bounties" as const,
  wired: true,
  nextTicket: "V1-5",
  notes:
    "Create from GitHub issue URL, board + filters, stub fund, exclusive 72h claim-lock. Lock ≠ money.",
};

export type BountiesModule = typeof bountiesModule;
