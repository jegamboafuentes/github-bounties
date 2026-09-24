import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  bounties,
  bountyIntelligence,
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
import { isUndefinedTableError, logIntelligenceEvent } from "../intelligence/errors";
import { expireClaimLocks } from "./expire";
import {
  matchesBoardIntelligenceFilter,
  matchesListIntelligenceFilter,
  parseComplexityFilter,
  parseLanguageFilter,
  readyIntelligenceBadge,
  type BoardIntelligenceBadge,
} from "./intelligence";
import {
  emptyBoardFunders,
  listBoardFunders,
  type BoardFunder,
  type BoardFunderSummary,
} from "./funders";
import { listWorkSignalsForBounties, type WorkSignalView } from "./signals";

export type BoardFilters = {
  repo?: string;
  status?: (typeof bountyStatusValues)[number] | string;
  complexity?: string;
  language?: string;
};

export type BoardListSort = "newest" | "amount";

/** Keyset position. Opaque on the wire; decoded by the public API. */
export type BoardKeyset =
  | { sort: "newest"; createdAt: Date; id: string }
  | { sort: "amount"; amountUsdc: string; id: string };

export type BoardPageQuery = {
  /** Page size. The query fetches one extra row to detect a next page. */
  limit: number;
  sort?: BoardListSort;
  cursor?: BoardKeyset | null;
  /** Ready cached badge only, or exclude those rows. Omit to leave intel open. */
  hasIntel?: boolean;
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
  /** Distinct funders, most recent contribution first. At most 5. */
  funders: BoardFunder[];
  /** Distinct funder total, including people past the visible avatar cap. */
  funderCount: number;
  fundedAt: Date | null;
  createdAt: Date;
  /** Always null after V2-4 sunset drain. Kept so old readers do not throw. */
  activeLock: null;
  workSignals: WorkSignalView[];
  payout: PayoutClaimView | null;
  /** Eligible merge recorded, but the PR author has no github_links row. */
  pendingHunterLink: PendingHunterLink | null;
  escrowFail: { code: string; reason: string; label: string } | null;
  /** Ready Gemini cache only. Null when missing/error — board hides the badge. */
  intelligence: BoardIntelligenceBadge | null;
};

const STATUS_SET = new Set<string>(bountyStatusValues);

const BOARD_COLUMNS = {
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
};

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

  const rows = await queryBoardRows(db, {
    repoFilter,
    status,
  });

  return (await hydrateBoardRows(db, rows)).filter((bounty) =>
    matchesBoardIntelligenceFilter(bounty.intelligence, filters),
  );
}

/**
 * Keyset page over the same board query. Omit this from the website board,
 * which still calls {@link listBoardBounties} and loads every matching row.
 * Complexity, language, and hasIntel are applied in SQL so a page is not
 * shortened by the in-memory badge filter. That filter still runs as a check.
 */
export async function listBoardBountiesPage(
  db: Database,
  filters: BoardFilters = {},
  page: BoardPageQuery,
  now: Date = new Date(),
): Promise<{ bounties: BoardBounty[]; hasMore: boolean }> {
  await expireClaimLocks(db, now);

  const repoFilter = filters.repo?.trim();
  const statusFilter = filters.status?.trim();
  const status =
    statusFilter && statusFilter !== "all" && STATUS_SET.has(statusFilter)
      ? (statusFilter as (typeof bountyStatusValues)[number])
      : undefined;
  const sort = page.sort ?? "newest";
  if (page.cursor && page.cursor.sort !== sort) {
    throw new Error("board cursor sort does not match the requested sort");
  }

  const rows = await queryBoardRows(db, {
    repoFilter,
    status,
    page: {
      sort,
      limit: page.limit + 1,
      cursor: page.cursor ?? null,
      complexity: parseComplexityFilter(filters.complexity),
      language: parseLanguageFilter(filters.language),
      hasIntel: page.hasIntel,
    },
  });
  const hydrated = (await hydrateBoardRows(db, rows)).filter((bounty) =>
    matchesListIntelligenceFilter(bounty.intelligence, {
      complexity: filters.complexity,
      language: filters.language,
      hasIntel: page.hasIntel,
    }),
  );
  const hasMore = hydrated.length > page.limit;
  return { bounties: hydrated.slice(0, page.limit), hasMore };
}

async function hydrateBoardRows(db: Database, rows: ListRow[]): Promise<BoardBounty[]> {
  const ids = rows.map((row) => row.id);
  const [payoutByBounty, signalsByBounty, fundersByBounty] = await Promise.all([
    listPayoutClaimsForBounties(db, ids),
    listWorkSignalsForBounties(db, ids),
    listBoardFunders(db, ids),
  ]);
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

  return rows.map((row) =>
    toBoardBounty(
      row,
      payoutByBounty.get(row.id) ?? null,
      payoutByBounty.has(row.id) ? null : (pendingByBounty.get(row.id) ?? null),
      signalsByBounty.get(row.id) ?? [],
      fundersByBounty.get(row.id) ?? emptyBoardFunders(),
    ),
  );
}

export async function getBoardBounty(
  bountyId: string,
  db: Database,
  now: Date = new Date(),
): Promise<BoardBounty | null> {
  await expireClaimLocks(db, now);

  const rows = await queryBoardRows(db, { bountyId });
  const row = rows[0];
  if (!row) return null;

  const [payoutByBounty, signalsByBounty, fundersByBounty] = await Promise.all([
    listPayoutClaimsForBounties(db, [row.id]),
    listWorkSignalsForBounties(db, [row.id]),
    listBoardFunders(db, [row.id]),
  ]);
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
  return toBoardBounty(
    row,
    payout,
    payout ? null : (pendingByBounty.get(row.id) ?? null),
    signalsByBounty.get(row.id) ?? [],
    fundersByBounty.get(row.id) ?? emptyBoardFunders(),
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
  intelStatus: string | null;
  intelComplexity: string | null;
  intelLanguageStack: string | null;
};

type PageQuery = {
  sort: BoardListSort;
  limit: number;
  cursor?: BoardKeyset | null;
  complexity?: "S" | "M" | "L";
  language?: string;
  hasIntel?: boolean;
};

async function queryBoardRows(
  db: Database,
  opts: {
    bountyId?: string;
    repoFilter?: string;
    status?: (typeof bountyStatusValues)[number];
    page?: PageQuery;
  },
): Promise<ListRow[]> {
  const whereClause = boardWhere(opts);
  const keyset = opts.page ? keysetWhere(opts.page.sort, opts.page.cursor) : undefined;
  const intelClause = opts.page ? listIntelWhere(opts.page) : undefined;
  const where = and(whereClause, keyset, intelClause);
  try {
    const query = db
      .select({
        ...BOARD_COLUMNS,
        intelStatus: bountyIntelligence.status,
        intelComplexity: bountyIntelligence.complexity,
        intelLanguageStack: bountyIntelligence.languageStack,
      })
      .from(bounties)
      .innerJoin(repos, eq(repos.id, bounties.repoId))
      .innerJoin(users, eq(users.id, bounties.posterUserId))
      .leftJoin(githubLinks, eq(githubLinks.userId, bounties.posterUserId))
      .leftJoin(escrows, eq(escrows.bountyId, bounties.id))
      .leftJoin(bountyIntelligence, eq(bountyIntelligence.bountyId, bounties.id))
      .where(where);
    if (opts.bountyId) return await query.limit(1);
    if (opts.page) return await query.orderBy(...orderFor(opts.page.sort)).limit(opts.page.limit);
    return await query.orderBy(desc(bounties.createdAt));
  } catch (err) {
    if (!isUndefinedTableError(err)) throw err;
    logIntelligenceEvent("bounty_intelligence_board_query_failed", {
      error: "missing_table",
      pgCode: "42P01",
    });
    const query = db
      .select(BOARD_COLUMNS)
      .from(bounties)
      .innerJoin(repos, eq(repos.id, bounties.repoId))
      .innerJoin(users, eq(users.id, bounties.posterUserId))
      .leftJoin(githubLinks, eq(githubLinks.userId, bounties.posterUserId))
      .leftJoin(escrows, eq(escrows.bountyId, bounties.id))
      .where(and(whereClause, keyset));
    const rows = opts.bountyId
      ? await query.limit(1)
      : opts.page
        ? await query.orderBy(...orderFor(opts.page.sort)).limit(opts.page.limit)
        : await query.orderBy(desc(bounties.createdAt));
    return rows.map((row) => ({
      ...row,
      intelStatus: null,
      intelComplexity: null,
      intelLanguageStack: null,
    }));
  }
}

function orderFor(sort: BoardListSort) {
  if (sort === "amount") return [desc(bounties.amountUsdc), desc(bounties.id)] as const;
  return [desc(bounties.createdAt), desc(bounties.id)] as const;
}

function keysetWhere(sort: BoardListSort, cursor: BoardKeyset | null | undefined) {
  if (!cursor || cursor.sort !== sort) return undefined;
  if (cursor.sort === "amount") {
    return sql`(
      ${bounties.amountUsdc} < cast(${cursor.amountUsdc} as numeric)
      or (
        ${bounties.amountUsdc} = cast(${cursor.amountUsdc} as numeric)
        and ${bounties.id} < cast(${cursor.id} as uuid)
      )
    )`;
  }
  const createdAt = cursor.createdAt.toISOString();
  return sql`(
    ${bounties.createdAt} < cast(${createdAt} as timestamptz)
    or (
      ${bounties.createdAt} = cast(${createdAt} as timestamptz)
      and ${bounties.id} < cast(${cursor.id} as uuid)
    )
  )`;
}

/** Same predicate as {@link matchesListIntelligenceFilter}, pushed into SQL for paging. */
function listIntelWhere(page: Pick<PageQuery, "complexity" | "language" | "hasIntel">) {
  const ready = sql`(
    ${bountyIntelligence.status} = 'ready'
    and ${bountyIntelligence.complexity} in ('S', 'M', 'L')
    and nullif(btrim(coalesce(${bountyIntelligence.languageStack}, '')), '') is not null
  )`;
  const parts = [];
  if (page.hasIntel === true) parts.push(ready);
  // NOT (unknown) is unknown, which WHERE drops. Coalesce so a missing badge stays in a has_intel=false page.
  if (page.hasIntel === false) parts.push(sql`not coalesce((${ready}), false)`);
  if (page.complexity || page.language) {
    if (page.hasIntel !== false) parts.push(ready);
    if (page.complexity) {
      parts.push(sql`${bountyIntelligence.complexity} = ${page.complexity}`);
    }
    if (page.language) {
      parts.push(
        sql`${bountyIntelligence.languageStack} ilike ${`%${escapeLike(page.language)}%`}`,
      );
    }
  }
  if (parts.length === 0) return undefined;
  return sql`(${sql.join(parts, sql` and `)})`;
}

function boardWhere(opts: {
  bountyId?: string;
  repoFilter?: string;
  status?: (typeof bountyStatusValues)[number];
}) {
  return and(
    opts.bountyId ? eq(bounties.id, opts.bountyId) : undefined,
    opts.repoFilter
      ? sql`${repos.fullName} ilike ${`%${escapeLike(opts.repoFilter)}%`}`
      : undefined,
    opts.status ? eq(bounties.status, opts.status) : undefined,
  );
}

function toBoardBounty(
  row: ListRow,
  payout: PayoutClaimView | null,
  pendingHunterLink: PendingHunterLink | null,
  workSignals: WorkSignalView[],
  funders: BoardFunderSummary,
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
    funders: funders.funders,
    funderCount: funders.funderCount,
    fundedAt: row.fundedAt,
    createdAt: row.createdAt,
    activeLock: null,
    workSignals,
    payout,
    pendingHunterLink,
    escrowFail: toEscrowFail(row.escrowFailCode, row.escrowFailReason),
    intelligence: readyIntelligenceBadge({
      status: row.intelStatus,
      complexity: row.intelComplexity,
      languageStack: row.intelLanguageStack,
    }),
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
