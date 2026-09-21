import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { bountyStatusValues } from "../db/schema";
import {
  assemblePlatformStats,
  asCount,
  asUsdc,
  PARTICIPATING_POOL_ROLES,
  TRANSACTED_ESCROW_STATUSES,
  type BountyStatus,
  type PlatformStats,
  type PlatformStatsAggregates,
} from "./definitions";

type StatusCountRow = {
  status: BountyStatus;
  n: unknown;
  faceUsdc: unknown;
};

type ScalarRow = {
  transactedUsdc?: unknown;
  participated?: unknown;
  githubLinked?: unknown;
  withBounties?: unknown;
  total?: unknown;
};

function sqlLiteralList(values: readonly string[]) {
  return sql`(${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

/**
 * Public platform aggregates. SQL-only over existing tables.
 * Shared by GET /api/stats and later server components (homepage, etc.).
 */
export async function getPlatformStats(
  db: Database,
  now: Date = new Date(),
): Promise<PlatformStats> {
  const transactedList = sqlLiteralList(TRANSACTED_ESCROW_STATUSES);
  const poolRoleList = sqlLiteralList(PARTICIPATING_POOL_ROLES);

  const [statusResult, volumeResult, developerResult, repoResult] = await Promise.all([
    db.execute(sql`
      select
        status,
        count(*)::int as n,
        coalesce(sum(amount_usdc), 0)::text as "faceUsdc"
      from bounties
      group by status
    `),
    db.execute(sql`
      select coalesce(sum(amount_usdc), 0)::text as "transactedUsdc"
      from escrows
      where status in ${transactedList}
    `),
    db.execute(sql`
      select
        (
          select count(*)::int from (
            select 'gh:' || gl.github_id::text as hid
            from github_links gl
            where gl.user_id in (
              select hunter_user_id from claims
              union
              select user_id from work_signals
              union
              select hunter_user_id from claim_locks
              union
              select user_id from pool_participants
              where user_id is not null
                and role in ${poolRoleList}
            )
            union
            select 'gh:' || pp.github_id::text
            from pool_participants pp
            where pp.role in ${poolRoleList}
            union
            select 'user:' || hunter.user_id::text
            from (
              select hunter_user_id as user_id from claims
              union
              select user_id from work_signals
              union
              select hunter_user_id from claim_locks
            ) hunter
            where not exists (
              select 1 from github_links gl where gl.user_id = hunter.user_id
            )
          ) hunters
        ) as participated,
        (select count(*)::int from github_links) as "githubLinked"
    `),
    db.execute(sql`
      select
        (select count(distinct repo_id)::int from bounties) as "withBounties",
        count(*)::int as total
      from repos
    `),
  ]);

  const byStatus: PlatformStatsAggregates["byStatus"] = {};
  const faceByStatus: PlatformStatsAggregates["faceByStatus"] = {};
  for (const row of rowsOf<StatusCountRow>(statusResult)) {
    if (!bountyStatusValues.includes(row.status)) continue;
    byStatus[row.status] = asCount(row.n);
    faceByStatus[row.status] = asUsdc(row.faceUsdc);
  }

  const volume = rowsOf<ScalarRow>(volumeResult)[0];
  const developers = rowsOf<ScalarRow>(developerResult)[0];
  const repos = rowsOf<ScalarRow>(repoResult)[0];

  return assemblePlatformStats(
    {
      byStatus,
      faceByStatus,
      transactedUsdc: asUsdc(volume?.transactedUsdc),
      developersParticipated: asCount(developers?.participated),
      developersGithubLinked: asCount(developers?.githubLinked),
      reposWithBounties: asCount(repos?.withBounties),
      reposTotal: asCount(repos?.total),
    },
    now,
  );
}
