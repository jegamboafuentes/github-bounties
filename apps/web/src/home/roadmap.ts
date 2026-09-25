import { PUBLIC_API_VERSION } from "../api/public/version";

/** Public /roadmap copy. Keep in sync with docs/roadmap.md. No invented ship dates. */

export const ROADMAP_INTRO =
  "Shipped versions and what is next. No invented ship dates.";

export const ROADMAP_STATUSES = ["shipped", "next", "then", "later", "parked"] as const;

export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export type RoadmapItem = {
  id: string;
  version: string;
  title: string;
  summary: string;
  status: RoadmapStatus;
  href?: string;
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
      "LIVE on PROD 2026-09-19 (githubbounties.xyz, Base mainnet USDC). V2-0…V2-5: 15% of post-fee to up to 10 hunters, signals, roster, claim-lock sunset.",
    status: "shipped",
  },
  {
    id: "pool-claim",
    version: "Pool Claim",
    title: "Pool member self-claim",
    summary:
      "LIVE on PROD 2026-09-20. Manual pool Claim (#47). Winner Claim pays winner + fee only. Each frozen pool hunter Claims their own share when they have a wallet.",
    status: "shipped",
  },
  {
    id: "fe-home",
    version: "FE",
    title: "FE epic",
    summary:
      "LIVE on PROD 2026-09-20. Homepage stats, this public roadmap, and vs-Lightning differentiators. Same aggregates as GET /api/stats. Bounty pages include the payout split charts.",
    status: "shipped",
  },
  {
    id: "v3-0",
    version: "V3",
    title: "V3 wave",
    summary:
      "LIVE on PROD 2026-09-21. Full GitHub issue + Gemini about/stack/complexity (AI estimates, cached). Related polish: board badges/filters, Settings/Post connected-only, homepage motion/roadmap refresh.",
    status: "shipped",
  },
  {
    id: "funding-wave",
    version: "Funding",
    title: "Funding wave",
    summary:
      "LIVE on PROD 2026-09-24. Crowdfunding (#61): USDC top-ups on already-funded bounties. Fund any public issue (#64) without installing the GitHub App, with Claim running through the public merge poller. Funder avatars (#65 to #67) on the board cards and on the bounty page Funders list.",
    status: "shipped",
  },
  {
    id: "v4",
    version: "V4",
    title: "API + MCP",
    summary: `DONE, LIVE on PROD 2026-09-25. /api/v1 (OpenAPI) + /mcp, version ${PUBLIC_API_VERSION}, 23 operations, 24 tools (#76 #79 #80 #81 #78). API money is OFF on PROD.`,
    status: "shipped",
    href: "/developers",
  },
  {
    id: "v5",
    version: "V5",
    title: "GitHub-native /bounty",
    summary:
      "GitHub-native bounty creation via a `/bounty` comment on a GitHub issue. Roadmap only. Nothing is built.",
    status: "next",
  },
  {
    id: "v6",
    version: "V6+",
    title: "Agent economy",
    summary: "The agent economy on x402. No ship date.",
    status: "then",
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
