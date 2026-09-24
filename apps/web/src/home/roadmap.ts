/** Public /roadmap copy. Keep in sync with docs/roadmap.md. No invented ship dates. */

export const ROADMAP_INTRO =
  "Upcoming versions, marked honestly. No invented ship dates.";

export const ROADMAP_STATUSES = ["shipped", "next", "then", "later", "parked"] as const;

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
      "V2-0…V2-5: 15% of post-fee to up to 10 hunters, signals, roster, claim-lock sunset. Live DEV dogfood done.",
    status: "shipped",
  },
  {
    id: "pool-claim",
    version: "V2.6",
    title: "Pool member self-claim",
    summary:
      "Manual pool Claim (#47) on PROD. Winner Claim pays winner + fee only. Each frozen pool hunter Claims their own share when they have a wallet.",
    status: "shipped",
  },
  {
    id: "fe-home",
    version: "FE",
    title: "Homepage stats, roadmap, differentiators",
    summary:
      "Live platform stats, public roadmap, and vs-Lightning differentiators on the homepage. Same aggregates as GET /api/stats.",
    status: "shipped",
  },
  {
    id: "fe-2",
    version: "FE-2",
    title: "Bounty detail split charts",
    summary: "Pie / split visuals on bounty payout breakdown. Shipped on bounty pages.",
    status: "shipped",
  },
  {
    id: "v3-0",
    version: "V3-0",
    title: "Issue body + bounty intelligence",
    summary:
      "Shipped on PROD. Full GitHub issue + Gemini about/stack/complexity (AI estimates, cached). Related polish: board badges/filters, Settings/Post connected-only, homepage motion/roadmap refresh.",
    status: "shipped",
  },
  {
    id: "funding-wave",
    version: "2026-09-24",
    title: "Funding wave",
    summary:
      "LIVE on PROD 2026-09-24. Crowdfunding: USDC top-ups on already-funded bounties. Fund any open public GitHub issue without installing the GitHub App, with Claim running through the public merge poller. Funder avatars on the board cards and on the bounty page Funders list.",
    status: "shipped",
  },
  {
    id: "v4",
    version: "V4",
    title: "API + MCP",
    summary:
      "In planning. AI can use the whole platform the way a human does. Public API documented with OpenAPI/Swagger, and an MCP server for Cursor, Claude, and ChatGPT.",
    status: "next",
  },
  {
    id: "v5",
    version: "V5",
    title: "GitHub-native /bounty",
    summary:
      "Comment `/bounty <amount>` on an issue. USDC only. GitHub App required.",
    status: "then",
  },
  {
    id: "v6",
    version: "V6+",
    title: "Agent economy",
    summary: "AI agents hunt and fund bounties over x402.",
    status: "later",
  },
  {
    id: "btc-payouts",
    version: "BTC",
    title: "BTC payouts",
    summary: "Parked. No schedule.",
    status: "parked",
  },
  {
    id: "hosted-checkout",
    version: "Checkout",
    title: "Hosted Coinbase checkout",
    summary:
      "Parked until settlement fee / net proceeds equal face (ADR 0001). x402 exact remains the fund rail.",
    status: "parked",
  },
] as const satisfies readonly RoadmapItem[];

export const ROADMAP_STATUS_LABEL: Record<RoadmapStatus, string> = {
  shipped: "Shipped",
  next: "Next",
  then: "Then",
  later: "Later",
  parked: "Parked",
};
