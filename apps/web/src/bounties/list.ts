import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  bounties,
  bountyStatusValues,
  claimLocks,
  escrows,
  githubLinks,
  repos,
  users,
} from "../db/schema";
import { listPayoutClaimsForBounties, type PayoutClaimView } from "../claims/read";
import { formatEscrowFailLabel } from "../escrow/fail";
import { claimedByUntilLabel, hunterLabel, isActiveClaimLock } from "./display";
import { expireClaimLocks } from "./expire";

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
  fundedAt: Date | null;
  createdAt: Date;
  activeLock: {
    hunterLabel: string;
    expiresAt: Date;
    hunterUserId: string;
    caption: string;
  } | null;
  payout: PayoutClaimView | null;
  escrowFail: { code: string; reason: string; label: string } | null;
};

const STATUS_SET = new Set<string>(bountyStatusValues);

/**
 * Board listing. Expires overdue locks first so captions stay accurate.
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
      fundedAt: bounties.fundedAt,
      createdAt: bounties.createdAt,
      lockStatus: claimLocks.status,
      lockExpiresAt: claimLocks.expiresAt,
      lockHunterUserId: claimLocks.hunterUserId,
      escrowFailCode: escrows.failCode,
      escrowFailReason: escrows.failReason,
    })
    .from(bounties)
    .innerJoin(repos, eq(repos.id, bounties.repoId))
    .innerJoin(users, eq(users.id, bounties.posterUserId))
    .leftJoin(
      claimLocks,
      and(eq(claimLocks.bountyId, bounties.id), eq(claimLocks.status, "active")),
    )
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

  const hunterIds = [
    ...new Set(
      rows
        .map((row) => row.lockHunterUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const hunterById = new Map<string, { displayName: string; githubLogin: string | null }>();
  if (hunterIds.length > 0) {
    const hunterRows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        githubLogin: githubLinks.githubLogin,
      })
      .from(users)
      .leftJoin(githubLinks, eq(githubLinks.userId, users.id))
      .where(inArray(users.id, hunterIds));
    for (const hunter of hunterRows) {
      hunterById.set(hunter.id, {
        displayName: hunter.displayName,
        githubLogin: hunter.githubLogin,
      });
    }
  }

  const payoutByBounty = await listPayoutClaimsForBounties(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => toBoardBounty(row, hunterById, now, payoutByBounty.get(row.id) ?? null));
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
      fundedAt: bounties.fundedAt,
      createdAt: bounties.createdAt,
      lockStatus: claimLocks.status,
      lockExpiresAt: claimLocks.expiresAt,
      lockHunterUserId: claimLocks.hunterUserId,
      escrowFailCode: escrows.failCode,
      escrowFailReason: escrows.failReason,
    })
    .from(bounties)
    .innerJoin(repos, eq(repos.id, bounties.repoId))
    .innerJoin(users, eq(users.id, bounties.posterUserId))
    .leftJoin(
      claimLocks,
      and(eq(claimLocks.bountyId, bounties.id), eq(claimLocks.status, "active")),
    )
    .leftJoin(escrows, eq(escrows.bountyId, bounties.id))
    .where(eq(bounties.id, bountyId))
    .limit(1);

  if (!row) return null;

  const hunterById = new Map<string, { displayName: string; githubLogin: string | null }>();
  if (row.lockHunterUserId) {
    const [hunter] = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        githubLogin: githubLinks.githubLogin,
      })
      .from(users)
      .leftJoin(githubLinks, eq(githubLinks.userId, users.id))
      .where(eq(users.id, row.lockHunterUserId))
      .limit(1);
    if (hunter) {
      hunterById.set(hunter.id, {
        displayName: hunter.displayName,
        githubLogin: hunter.githubLogin,
      });
    }
  }

  const payoutByBounty = await listPayoutClaimsForBounties(db, [row.id]);
  return toBoardBounty(row, hunterById, now, payoutByBounty.get(row.id) ?? null);
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
  fundedAt: Date | null;
  createdAt: Date;
  lockStatus: string | null;
  lockExpiresAt: Date | null;
  lockHunterUserId: string | null;
  escrowFailCode: string | null;
  escrowFailReason: string | null;
};

function toBoardBounty(
  row: ListRow,
  hunterById: Map<string, { displayName: string; githubLogin: string | null }>,
  now: Date,
  payout: PayoutClaimView | null,
): BoardBounty {
  const lock =
    row.lockStatus && row.lockExpiresAt
      ? { status: row.lockStatus, expiresAt: row.lockExpiresAt }
      : null;
  const hunter = row.lockHunterUserId ? hunterById.get(row.lockHunterUserId) : undefined;
  const label = hunterLabel({
    githubLogin: hunter?.githubLogin,
    displayName: hunter?.displayName,
  });
  const active = isActiveClaimLock(lock, now);
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
    fundedAt: row.fundedAt,
    createdAt: row.createdAt,
    activeLock:
      active && row.lockExpiresAt && row.lockHunterUserId
        ? {
            hunterLabel: label,
            expiresAt: row.lockExpiresAt,
            hunterUserId: row.lockHunterUserId,
            caption: claimedByUntilLabel({
              hunterLabel: label,
              expiresAt: row.lockExpiresAt,
            }),
          }
        : null,
    payout,
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
