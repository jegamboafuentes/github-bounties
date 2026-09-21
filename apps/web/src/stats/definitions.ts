import { bountyStatusValues, escrowStatusValues } from "../db/schema";
import { DEFAULT_CURRENCY } from "../lib/constants";
import { atomicToUsdc, usdcToAtomic } from "../lib/money";

/** Public GET /api/stats payload version. Bump when field names or bucket membership change. */
export const PLATFORM_STATS_SCHEMA_VERSION = 2;

export type BountyStatus = (typeof bountyStatusValues)[number];
export type EscrowStatus = (typeof escrowStatusValues)[number];

/**
 * Product “open” (FE-0): fundable draft + money already locked for hunt.
 * `pending_fund` is the create-form write (schema has no `draft`).
 * Residual `claim_locked` is treated as funded/open after V2-4 sunset.
 */
export const PRODUCT_OPEN_BOUNTY_STATUSES = [
  "pending_fund",
  "funded",
  "claim_locked",
] as const satisfies readonly BountyStatus[];

/** Board “Completed (paid)” / “Winner paid — pool pending”. */
export const COMPLETED_BOUNTY_STATUSES = [
  "settled",
  "settled_partial",
] as const satisfies readonly BountyStatus[];

/** Terminal unpaid / cancelled / never-funded-void. */
export const CLOSED_BOUNTY_STATUSES = [
  "refunded",
  "cancelled",
  "expired",
  "void",
] as const satisfies readonly BountyStatus[];

/** Money in motion; not product-open and not a terminal close. */
export const IN_FLIGHT_BOUNTY_STATUSES = [
  "settling",
  "refunding",
] as const satisfies readonly BountyStatus[];

/**
 * Face USDC that reached a funded or settled money event on `escrows`.
 * Includes refunded rows (they were funded first). Excludes `pending` / `failed`
 * (no lock) and never adds `fee_ledger` / `FEE_OUT` legs.
 */
export const TRANSACTED_ESCROW_STATUSES = [
  "funded",
  "settling",
  "settled",
  "settled_partial",
  "refunding",
  "refunded",
] as const satisfies readonly EscrowStatus[];

/** Face still held for an open hunt (product open minus unfunded drafts). */
export const OUTSTANDING_OPEN_BOUNTY_STATUSES = [
  "funded",
  "claim_locked",
] as const satisfies readonly BountyStatus[];

/** Face still attributed while settle/refund is running. */
export const OUTSTANDING_IN_FLIGHT_BOUNTY_STATUSES = [
  "settling",
  "refunding",
  "settled_partial",
] as const satisfies readonly BountyStatus[];

/**
 * Pool roster roles that count as hunter participation.
 * Overflow submitted a qualifying PR (cap 10); excluded poster/bot did not hunt.
 */
export const PARTICIPATING_POOL_ROLES = ["winner", "pool", "overflow"] as const;

export const PLATFORM_STATS_BUCKETS = {
  open: [...PRODUCT_OPEN_BOUNTY_STATUSES],
  completed: [...COMPLETED_BOUNTY_STATUSES],
  closed: [...CLOSED_BOUNTY_STATUSES],
  inFlight: [...IN_FLIGHT_BOUNTY_STATUSES],
} as const;

export type BountyStatusCounts = Record<BountyStatus, number>;

export type PlatformStats = {
  ok: true;
  schemaVersion: typeof PLATFORM_STATS_SCHEMA_VERSION;
  generatedAt: string;
  product: "GitHub Bounties";
  currency: typeof DEFAULT_CURRENCY;
  buckets: typeof PLATFORM_STATS_BUCKETS;
  bounties: {
    total: number;
    open: number;
    completed: number;
    closed: number;
    inFlight: number;
    byStatus: BountyStatusCounts;
  };
  volumeUsdc: {
    /** Sum of escrow face amounts that reached funded/settled money. Not fees. */
    transacted: string;
    /** Face still locked on funded / residual claim_locked bounties. */
    outstandingOpen: string;
    /** Face on settling / refunding / settled_partial. */
    outstandingInFlight: string;
    /** Face on settled + settled_partial. */
    completed: string;
  };
  developers: {
    /** Distinct hunters (GitHub id when known, else user id). */
    participated: number;
    /** All `github_links` rows (connected GitHub identities). */
    githubLinked: number;
  };
  repos: {
    /** Distinct repos with ≥1 bounty row (any status). Not bare App installs. */
    withBounties: number;
    total: number;
  };
};

export type PlatformStatsAggregates = {
  byStatus: Partial<Record<BountyStatus, number>>;
  faceByStatus: Partial<Record<BountyStatus, string>>;
  transactedUsdc: string;
  developersParticipated: number;
  developersGithubLinked: number;
  reposWithBounties: number;
  reposTotal: number;
};

export function emptyBountyStatusCounts(): BountyStatusCounts {
  return Object.fromEntries(bountyStatusValues.map((status) => [status, 0])) as BountyStatusCounts;
}

export function emptyFaceByStatus(): Record<BountyStatus, string> {
  return Object.fromEntries(bountyStatusValues.map((status) => [status, "0.000000"])) as Record<
    BountyStatus,
    string
  >;
}

export function emptyPlatformStatsAggregates(): PlatformStatsAggregates {
  return {
    byStatus: {},
    faceByStatus: {},
    transactedUsdc: "0",
    developersParticipated: 0,
    developersGithubLinked: 0,
    reposWithBounties: 0,
    reposTotal: 0,
  };
}

export function bountyStatusBucket(
  status: string,
): keyof typeof PLATFORM_STATS_BUCKETS | null {
  if ((PRODUCT_OPEN_BOUNTY_STATUSES as readonly string[]).includes(status)) return "open";
  if ((COMPLETED_BOUNTY_STATUSES as readonly string[]).includes(status)) return "completed";
  if ((CLOSED_BOUNTY_STATUSES as readonly string[]).includes(status)) return "closed";
  if ((IN_FLIGHT_BOUNTY_STATUSES as readonly string[]).includes(status)) return "inFlight";
  return null;
}

export function isTransactedEscrowStatus(status: string): boolean {
  return (TRANSACTED_ESCROW_STATUSES as readonly string[]).includes(status);
}

export function asCount(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

export function asUsdc(value: unknown): string {
  if (value == null || value === "") return "0.000000";
  try {
    return atomicToUsdc(usdcToAtomic(String(value)));
  } catch {
    return "0.000000";
  }
}

function sumUsdc(amounts: string[]): string {
  let total = 0n;
  for (const amount of amounts) {
    total += usdcToAtomic(asUsdc(amount));
  }
  return atomicToUsdc(total);
}

export function assemblePlatformStats(
  raw: PlatformStatsAggregates,
  now: Date = new Date(),
): PlatformStats {
  const byStatus = emptyBountyStatusCounts();
  for (const status of bountyStatusValues) {
    byStatus[status] = asCount(raw.byStatus[status]);
  }

  const face = emptyFaceByStatus();
  for (const status of bountyStatusValues) {
    face[status] = asUsdc(raw.faceByStatus[status]);
  }

  const sumCounts = (statuses: readonly BountyStatus[]) =>
    statuses.reduce((acc, status) => acc + byStatus[status], 0);

  return {
    ok: true,
    schemaVersion: PLATFORM_STATS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    product: "GitHub Bounties",
    currency: DEFAULT_CURRENCY,
    buckets: PLATFORM_STATS_BUCKETS,
    bounties: {
      total: bountyStatusValues.reduce((acc, status) => acc + byStatus[status], 0),
      open: sumCounts(PRODUCT_OPEN_BOUNTY_STATUSES),
      completed: sumCounts(COMPLETED_BOUNTY_STATUSES),
      closed: sumCounts(CLOSED_BOUNTY_STATUSES),
      inFlight: sumCounts(IN_FLIGHT_BOUNTY_STATUSES),
      byStatus,
    },
    volumeUsdc: {
      transacted: asUsdc(raw.transactedUsdc),
      outstandingOpen: sumUsdc(OUTSTANDING_OPEN_BOUNTY_STATUSES.map((status) => face[status])),
      outstandingInFlight: sumUsdc(
        OUTSTANDING_IN_FLIGHT_BOUNTY_STATUSES.map((status) => face[status]),
      ),
      completed: sumUsdc(COMPLETED_BOUNTY_STATUSES.map((status) => face[status])),
    },
    developers: {
      participated: asCount(raw.developersParticipated),
      githubLinked: asCount(raw.developersGithubLinked),
    },
    repos: {
      withBounties: asCount(raw.reposWithBounties),
      total: asCount(raw.reposTotal),
    },
  };
}
