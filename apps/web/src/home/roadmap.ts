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
      "Google sign-in, GitHub App, public board. 2% fee at settlement. Winner is the merged PR author that closes funded #N. Live on production.",
    status: "shipped",
  },
  {
    id: "v2",
    version: "V2",
    title: "Parallel hunt + participation pool",
    summary:
      "15% of post-fee split among up to 10 hunters. Optional Working on this, roster, and payout breakdown. Exclusive claim-lock retired. Live on production.",
    status: "shipped",
  },
  {
    id: "pool-claim",
    version: "V2",
    title: "Pool member self-claim",
    summary:
      "Winner Claim pays winner + fee only. Each pool hunter Claims their own share when they have a wallet.",
    status: "shipped",
  },
  {
    id: "fe",
    version: "UI",
    title: "Homepage + payout charts",
    summary:
      "Live platform stats, public roadmap, and split pies on bounty pages.",
    status: "shipped",
  },
  {
    id: "v3-0",
    version: "V3-0",
    title: "Issue body + bounty intelligence",
    summary:
      "Full GitHub issue on the bounty page. Gemini estimates about, stack, and complexity (AI estimates, cached). Board badges and filters. Live on DEV.",
    status: "shipped",
  },
  {
    id: "v3-prod",
    version: "V3",
    title: "Intelligence on production",
    summary:
      "Bring issue body, bounty intelligence, and repos-with-bounties to production. No public date.",
    status: "in_progress",
  },
  {
    id: "hosted-checkout",
    version: "Next",
    title: "Hosted Coinbase checkout",
    summary:
      "Still off until settlement fee and net proceeds match face. x402 exact stays the fund rail.",
    status: "planned",
  },
] as const satisfies readonly RoadmapItem[];

export const ROADMAP_STATUS_LABEL: Record<RoadmapStatus, string> = {
  shipped: "Shipped",
  in_progress: "In progress",
  planned: "Planned",
};

export type RoadmapFocus = {
  activeId: string | null;
  activeIndex: number;
  /** 0–1 rail fill, aligned to the active (or last shipped) node. */
  railProgress: number;
};

/** First in-progress item, else the latest shipped item. Drives the rail + highlight. */
export function roadmapFocus(items: readonly RoadmapItem[] = PUBLIC_ROADMAP): RoadmapFocus {
  if (items.length === 0) {
    return { activeId: null, activeIndex: -1, railProgress: 0 };
  }

  let activeIndex = items.findIndex((item) => item.status === "in_progress");
  if (activeIndex < 0) {
    activeIndex = -1;
    for (let i = 0; i < items.length; i += 1) {
      if (items[i]?.status === "shipped") activeIndex = i;
    }
  }
  if (activeIndex < 0) {
    return { activeId: items[0]?.id ?? null, activeIndex: 0, railProgress: 0 };
  }

  const denom = items.length - 1;
  return {
    activeId: items[activeIndex]?.id ?? null,
    activeIndex,
    railProgress: denom === 0 ? 1 : activeIndex / denom,
  };
}
