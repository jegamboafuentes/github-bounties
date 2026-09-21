/**
 * Bounties module — post from issue URL, board, escrow fund-lock, parallel hunt.
 * Exclusive 72h claim-lock is retired (V2-4). Merge is still truth.
 */
export const bountiesModule = {
  name: "bounties" as const,
  wired: true,
  nextTicket: "V3-0",
  notes:
    "Create from GitHub issue URL, board + filters, escrow fund-lock, Working on this signals, pool roster + payout breakdown, hunter claim payout. Signals ≠ money. Detail shows the full GitHub issue + Gemini intelligence (V3-0, DEV). Live V2 dogfood is done.",
};

export type BountiesModule = typeof bountiesModule;
