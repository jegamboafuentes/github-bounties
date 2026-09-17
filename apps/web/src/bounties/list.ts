import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  bounties,
  bountyStatusValues,
  escrows,
  githubLinks,
  repos,
  users,
} from "../db/schema";
import {
  listPendingHunterLinksForBounties,
  type PendingHunterLink,
} from "../claims/pending-link";
import { listPayoutClaimsForBounties, type PayoutClaimView } from "../claims/read";
import { formatEscrowFailLabel } from "../escrow/fail";
import { expireClaimLocks } from "./expire";
import { listWorkSignalsForBounties, type WorkSignalView } from "./signals";

export type BoardFilters = {
  repo?: string;
  status?: (typeof bountyStatusValues)[number] | string;
};

export type BoardBounty = {
  id: string;
  title: string;
  url: string;
  amountUsdc: string;
  currency: string;
  status: string;
  githubIssueNumber: number;
  repoFullName: string;
  posterDisplayName: string;
  posterUserId: string;
  /** Present when the poster has a `github_links` row. */
  posterGithubLogin: string | null;
  fundedAt: Date | null;
  createdAt: Date;
  /** Always null after V2-4 sunset drain. Kept so old readers do not throw. */
  activeLock: null;
  workSignals: WorkSignalView[];
  payout: PayoutClaimView | null;
  /** Eligible merge recorded, but the PR author has no github_links row. */
  pendingHunterLink: PendingHunterLink | null;
  escrowFail: { code: string; reason: string; label: string } | null;
};

const STATUS_SET = new Set<string>(bountyStatusValues);

/**
 * Board listing. Drains residual exclusive V1 claim-locks first so the board
 * never shows “Claimed by X until …”.
 */
export async function listBoardBounties(
  db: Database,
  filters: BoardFilters = {},
  now: Date = new Date(),
): Promise<BoardBounty[]> {
  await expireClaimLocks(db, now);

  const repoFilter = filters.repo?.trim();
  const statusFilter = filters.status?.trim();
  const status =
    statusFilter && statusFilter !== "all" && STATUS_SET.has(statusFilter)
      ? (statusFilter as (typeof bountyStatusValues)[number])
      : undefined;

  const rows = await db
    .select({
      id: bounties.id,
      title: bounties.title,
      url: bounties.url,
      amountUsdc: bounties.amountUsdc,
      currency: bounties.currency,
      status: bounties.status,
      githubIssueNumber: bounties.githubIssueNumber,
      repoFullName: repos.fullName,
      posterDisplayName: users.displayName,
      posterUserId: bounties.posterUserId,
      posterGithubLogin: githubLinks.githubLogin,
      fundedAt: bounties.fundedAt,
      createdAt: bounties.createdAt,
      escrowFailCode: escrows.failCode,
      escrowFailReason: escrows.failReason,
    })
    .from(bounties)
    .innerJoin(repos, eq(repos.id, bounties.repoId))
    .innerJoin(users, eq(users.id, bounties.posterUserId))
    .leftJoin(githubLinks, eq(githubLinks.userId, bounties.posterUserId))
    .leftJoin(escrows, eq(escrows.bountyId, bounties.id))
    .where(
      and(
        repoFilter
          ? sql`${repos.fullName} ilike ${`%${escapeLike(repoFilter)}%`}`
          : undefined,
        status ? eq(bounties.status, status) : undefined,
      ),
    )
    .orderBy(desc(bounties.createdAt));

  const ids = rows.map((row) => row.id);
  const payoutByBounty = await listPayoutClaimsForBounties(db, ids);
  const pendingByBounty = await listPendingHunterLinksForBounties(
    db,
    rows
      .filter((row) => !payoutByBounty.has(row.id))
      .map((row) => ({
        id: row.id,
        githubIssueNumber: row.githubIssueNumber,
        repoFullName: row.repoFullName,
      })),
  );
  const signalsByBounty = await listWorkSignalsForBounties(db, ids);

  return rows.map((row) =>
    toBoardBounty(
      row,
      payoutByBounty.get(row.id) ?? null,
      payoutByBounty.has(row.id) ? null : (pendingByBounty.get(row.id) ?? null),
      signalsByBounty.get(row.id) ?? [],
    ),
  );
}

export async function getBoardBounty(
  bountyId: string,
  db: Database,
  now: Date = new Date(),
): Promise<BoardBounty | null> {
  await expireClaimLocks(db, now);

  const [row] = await db
    .select({
      id: bounties.id,
      title: bounties.title,
      url: bounties.url,
      amountUsdc: bounties.amountUsdc,
      currency: bounties.currency,
      status: bounties.status,
      githubIssueNumber: bounties.githubIssueNumber,
      repoFullName: repos.fullName,
      posterDisplayName: users.displayName,
      posterUserId: bounties.posterUserId,
      posterGithubLogin: githubLinks.githubLogin,
      fundedAt: bounties.fundedAt,
      createdAt: bounties.createdAt,
      escrowFailCode: escrows.failCode,
      escrowFailReason: escrows.failReason,
    })
    .from(bounties)
    .innerJoin(repos, eq(repos.id, bounties.repoId))
    .innerJoin(users, eq(users.id, bounties.posterUserId))
    .leftJoin(githubLinks, eq(githubLinks.userId, bounties.posterUserId))
    .leftJoin(escrows, eq(escrows.bountyId, bounties.id))
    .where(eq(bounties.id, bountyId))
    .limit(1);

  if (!row) return null;

  const payoutByBounty = await listPayoutClaimsForBounties(db, [row.id]);
  const payout = payoutByBounty.get(row.id) ?? null;
  const pendingByBounty = payout
    ? new Map()
    : await listPendingHunterLinksForBounties(db, [
        {
          id: row.id,
          githubIssueNumber: row.githubIssueNumber,
          repoFullName: row.repoFullName,
        },
      ]);
  const signalsByBounty = await listWorkSignalsForBounties(db, [row.id]);
  return toBoardBounty(
    row,
    payout,
    payout ? null : (pendingByBounty.get(row.id) ?? null),
    signalsByBounty.get(row.id) ?? [],
  );
}

type ListRow = {
  id: string;
  title: string;
  url: string;
  amountUsdc: string;
  currency: string;
  status: string;
  githubIssueNumber: number;
  repoFullName: string;
  posterDisplayName: string;
  posterUserId: string;
  posterGithubLogin: string | null;
  fundedAt: Date | null;
  createdAt: Date;
  escrowFailCode: string | null;
  escrowFailReason: string | null;
};

function toBoardBounty(
  row: ListRow,
  payout: PayoutClaimView | null,
  pendingHunterLink: PendingHunterLink | null,
  workSignals: WorkSignalView[],
): BoardBounty {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    amountUsdc: row.amountUsdc,
    currency: row.currency,
    status: row.status,
    githubIssueNumber: row.githubIssueNumber,
    repoFullName: row.repoFullName,
    posterDisplayName: row.posterDisplayName,
    posterUserId: row.posterUserId,
    posterGithubLogin: row.posterGithubLogin,
    fundedAt: row.fundedAt,
    createdAt: row.createdAt,
    activeLock: null,
    workSignals,
    payout,
    pendingHunterLink,
    escrowFail: toEscrowFail(row.escrowFailCode, row.escrowFailReason),
  };
}

function toEscrowFail(
  code: string | null,
  reason: string | null,
): BoardBounty["escrowFail"] {
  const label = formatEscrowFailLabel(code, reason);
  if (!label || !code) return null;
  return { code, reason: reason ?? "", label };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
