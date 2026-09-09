/**
 * Bounties module stub — CRUD / fund UI in later V1 tickets.
 * Schema: `bounties` (status pending_fund → funded → …).
 */
export const bountiesModule = {
  name: "bounties" as const,
  wired: false,
  nextTicket: "V1-4",
  notes: "One active bounty per (repo_id, github_issue_number).",
};

export type BountiesModule = typeof bountiesModule;
