import { formatUsdc } from "@/bounties/display";
import { DEFAULT_CURRENCY } from "@/lib/constants";
import type { PlatformStats } from "@/stats";

/**
 * Homepage cards. Labels and hints match docs/stats.md field definitions.
 * Volume is `volumeUsdc.transacted` (face only; never fee legs).
 */
export const HOMEPAGE_STAT_KEYS = [
  "bounties.total",
  "bounties.open",
  "bounties.completed",
  "bounties.closed",
  "volumeUsdc.transacted",
  "developers.participated",
  "repos.connected",
] as const;

export type HomepageStatKey = (typeof HOMEPAGE_STAT_KEYS)[number];

export type HomepageStatCard = {
  key: HomepageStatKey;
  label: string;
  value: string;
  hint: string;
};

export function formatStatCount(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export function formatTransactedVolumeUsdc(transacted: string): string {
  return `${formatUsdc(transacted)} ${DEFAULT_CURRENCY}`;
}

export function homepageStatCards(stats: PlatformStats): HomepageStatCard[] {
  return [
    {
      key: "bounties.total",
      label: "Bounties",
      value: formatStatCount(stats.bounties.total),
      hint: "Every bounty_status. Sum of open + completed + closed + in-flight.",
    },
    {
      key: "bounties.open",
      label: "Open",
      value: formatStatCount(stats.bounties.open),
      hint: "pending_fund + funded + claim_locked (product open / fundable).",
    },
    {
      key: "bounties.completed",
      label: "Completed",
      value: formatStatCount(stats.bounties.completed),
      hint: "settled + settled_partial — Completed (paid) / Winner paid — pool pending.",
    },
    {
      key: "bounties.closed",
      label: "Closed",
      value: formatStatCount(stats.bounties.closed),
      hint: "refunded + cancelled + expired + void (terminal unpaid).",
    },
    {
      key: "volumeUsdc.transacted",
      label: "USDC volume",
      value: formatTransactedVolumeUsdc(stats.volumeUsdc.transacted),
      hint: "Face that reached a funded or settled money event. Excludes fees.",
    },
    {
      key: "developers.participated",
      label: "Developers",
      value: formatStatCount(stats.developers.participated),
      hint: "Distinct hunters. Poster-only users are excluded.",
    },
    {
      key: "repos.connected",
      label: "Repos connected",
      value: formatStatCount(stats.repos.connected),
      hint: "repos.is_active — App-connected repositories.",
    },
  ];
}
