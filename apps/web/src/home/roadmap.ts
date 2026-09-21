/** Public homepage roadmap. Keep in sync with docs/roadmap.md. No invented ship dates. */

export const ROADMAP_STATUSES = ["shipped", "in_progress", "planned"] as const;

export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export type RoadmapItem = {
  id: string;
  version: string;
  title: string;
  summary: string;
  status: RoadmapStatus;
};

export const PUBLIC_ROADMAP = [
  {
    id: "v1",
    version: "V1",
    title: "USDC escrow + merge is truth",
    summary:
      "Google sign-in, GitHub App, board, 2% fee, winner = merged PR author that closes funded #N.",
    status: "shipped",
  },
  {
    id: "v2",
    version: "V2",
    title: "Parallel hunt + participation pool",
    summary:
      "V2-0…V2-4: 15% of post-fee to up to 10 hunters, signals, roster, claim-lock sunset.",
    status: "shipped",
  },
  {
    id: "v2-5",
    version: "V2-5",
    title: "DEV dogfood",
    summary:
      "Checklist ready. Live multi-hunter dogfood pending Enrique — no public ship date.",
    status: "in_progress",
  },
  {
    id: "v3-0",
    version: "V3-0",
    title: "Issue body + bounty intelligence",
    summary:
      "Full GitHub issue on the bounty page; Gemini estimates about/stack/complexity (AI estimates, cached).",
    status: "in_progress",
  },
  {
    id: "fe-2",
    version: "V3+",
    title: "Bounty detail split charts",
    summary: "Pie / split visuals on bounty pages (FE-2). Not on this homepage slice.",
    status: "planned",
  },
  {
    id: "hosted-checkout",
    version: "V3+",
    title: "Hosted Coinbase checkout",
    summary:
      "Still disabled until settlement fee / net proceeds equal face. x402 exact remains the fund rail.",
    status: "planned",
  },
  {
    id: "pool-claim",
    version: "V2.6",
    title: "Pool member self-claim",
    summary:
      "Winner Claim pays winner + fee only. Each frozen pool hunter Claims their own share when they have a wallet.",
    status: "shipped",
  },
] as const satisfies readonly RoadmapItem[];

export const ROADMAP_STATUS_LABEL: Record<RoadmapStatus, string> = {
  shipped: "Shipped",
  in_progress: "In progress",
  planned: "Planned",
};
