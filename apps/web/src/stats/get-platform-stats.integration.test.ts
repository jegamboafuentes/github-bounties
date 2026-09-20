import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { usdcToAtomic } from "../lib/money";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import {
  allocationLedger,
  bounties,
  claimLocks,
  claims,
  escrows,
  feeLedger,
  githubLinks,
  poolParticipants,
  repos,
  users,
  workSignals,
} from "../db/schema";
import {
  assemblePlatformStats,
  emptyPlatformStatsAggregates,
  PLATFORM_STATS_SCHEMA_VERSION,
} from "./definitions";
import { getPlatformStats } from "./get-platform-stats";

loadDotenvFiles();

const NOW = new Date("2026-09-20T15:00:00.000Z");

describe("getPlatformStats (empty-or-seeded Postgres)", () => {
  it("matches independent SQL on the current database (zeros when empty)", async () => {
    const { db, sql } = createDb();
    try {
      const stats = await getPlatformStats(db, NOW);
      const expected = await expectedFromSql(sql, NOW);

      assert.equal(stats.ok, true);
      assert.equal(stats.schemaVersion, PLATFORM_STATS_SCHEMA_VERSION);
      assert.equal(stats.generatedAt, NOW.toISOString());
      assert.deepEqual(stats.bounties, expected.bounties);
      assert.deepEqual(stats.volumeUsdc, expected.volumeUsdc);
      assert.deepEqual(stats.developers, expected.developers);
      assert.deepEqual(stats.repos, expected.repos);

      const empty = assemblePlatformStats(emptyPlatformStatsAggregates(), NOW);
      if (expected.bounties.total === 0) {
        assert.deepEqual(stats.bounties, empty.bounties);
        assert.deepEqual(stats.volumeUsdc, empty.volumeUsdc);
        assert.deepEqual(stats.developers, empty.developers);
        assert.deepEqual(stats.repos, empty.repos);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("adds isolated fixtures: open/completed buckets, face volume without fees, hunters, repos", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const posterId = randomUUID();
    const hunterLinkedId = randomUUID();
    const hunterUnlinkedId = randomUUID();
    const extraRepoOwnerId = randomUUID();
    const repoActiveId = randomUUID();
    const repoInactiveId = randomUUID();
    const pendingId = randomUUID();
    const fundedId = randomUUID();
    const settledId = randomUUID();
    const refundedId = randomUUID();
    const pendingEscrowId = randomUUID();
    const fundedEscrowId = randomUUID();
    const settledEscrowId = randomUUID();
    const refundedEscrowId = randomUUID();
    const githubLinked = BigInt(80_000_000 + Number.parseInt(suffix.slice(0, 6), 16));
    const githubUnlinkedPool = BigInt(81_000_000 + Number.parseInt(suffix.slice(0, 6), 16));

    try {
      const before = await getPlatformStats(db, NOW);

      await db.insert(users).values([
        {
          id: posterId,
          googleSub: `stats-poster-${suffix}`,
          email: `stats-poster-${suffix}@example.com`,
          displayName: "Stats Poster",
        },
        {
          id: hunterLinkedId,
          googleSub: `stats-hunter-${suffix}`,
          email: `stats-hunter-${suffix}@example.com`,
          displayName: "Stats Hunter",
        },
        {
          id: hunterUnlinkedId,
          googleSub: `stats-unlinked-${suffix}`,
          email: `stats-unlinked-${suffix}@example.com`,
          displayName: "Unlinked Signaler",
        },
        {
          id: extraRepoOwnerId,
          googleSub: `stats-owner-${suffix}`,
          email: `stats-owner-${suffix}@example.com`,
          displayName: "Repo Owner",
        },
      ]);

      await db.insert(githubLinks).values({
        userId: hunterLinkedId,
        githubId: githubLinked,
        githubLogin: `stats-hunter-${suffix}`,
      });

      await db.insert(repos).values([
        {
          id: repoActiveId,
          githubRepoId: BigInt(82_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
          fullName: `stats/active-${suffix}`,
          installationId: BigInt(77),
          connectedByUserId: extraRepoOwnerId,
          isActive: true,
        },
        {
          id: repoInactiveId,
          githubRepoId: BigInt(83_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
          fullName: `stats/inactive-${suffix}`,
          installationId: BigInt(78),
          connectedByUserId: extraRepoOwnerId,
          isActive: false,
        },
      ]);

      await db.insert(bounties).values([
        {
          id: pendingId,
          repoId: repoActiveId,
          githubIssueNumber: 101,
          url: `https://github.com/stats/active-${suffix}/issues/101`,
          posterUserId: posterId,
          amountUsdc: "25.000000",
          status: "pending_fund",
          title: "stats pending",
        },
        {
          id: fundedId,
          repoId: repoActiveId,
          githubIssueNumber: 102,
          url: `https://github.com/stats/active-${suffix}/issues/102`,
          posterUserId: posterId,
          amountUsdc: "100.000000",
          status: "funded",
          title: "stats funded",
          fundedAt: NOW,
        },
        {
          id: settledId,
          repoId: repoActiveId,
          githubIssueNumber: 103,
          url: `https://github.com/stats/active-${suffix}/issues/103`,
          posterUserId: posterId,
          amountUsdc: "50.000000",
          status: "settled",
          title: "stats settled",
          fundedAt: NOW,
        },
        {
          id: refundedId,
          repoId: repoActiveId,
          githubIssueNumber: 104,
          url: `https://github.com/stats/active-${suffix}/issues/104`,
          posterUserId: posterId,
          amountUsdc: "10.000000",
          status: "refunded",
          title: "stats refunded",
          fundedAt: NOW,
        },
      ]);

      await db.insert(escrows).values([
        {
          id: pendingEscrowId,
          bountyId: pendingId,
          amountUsdc: "25.000000",
          status: "pending",
        },
        {
          id: fundedEscrowId,
          bountyId: fundedId,
          amountUsdc: "100.000000",
          status: "funded",
        },
        {
          id: settledEscrowId,
          bountyId: settledId,
          amountUsdc: "50.000000",
          status: "settled",
        },
        {
          id: refundedEscrowId,
          bountyId: refundedId,
          amountUsdc: "10.000000",
          status: "refunded",
        },
      ]);

      await db.insert(feeLedger).values({
        bountyId: settledId,
        faceUsdc: "50.000000",
        feeUsdc: "1.000000",
        feeBps: 200,
        settledAt: NOW,
      });

      await db.insert(allocationLedger).values({
        bountyId: settledId,
        kind: "FEE_OUT",
        amountUsdc: "1.000000",
        idempotencyKey: `stats-fee-${suffix}`,
        status: "confirmed",
      });

      await db.insert(claims).values({
        bountyId: settledId,
        hunterUserId: hunterLinkedId,
        status: "paid",
        prNumber: 9,
        prAuthorLogin: `stats-hunter-${suffix}`,
      });

      await db.insert(workSignals).values({
        bountyId: fundedId,
        userId: hunterUnlinkedId,
      });

      await db.insert(claimLocks).values({
        bountyId: fundedId,
        hunterUserId: hunterLinkedId,
        lockedAt: new Date("2026-09-01T00:00:00.000Z"),
        expiresAt: new Date("2026-09-04T00:00:00.000Z"),
        status: "released",
      });

      await db.insert(poolParticipants).values({
        bountyId: settledId,
        githubId: githubUnlinkedPool,
        githubLogin: `stats-pool-${suffix}`,
        role: "pool",
        shareUsdc: "0.735000",
      });

      const after = await getPlatformStats(db, NOW);

      assert.equal(after.bounties.total, before.bounties.total + 4);
      assert.equal(after.bounties.open, before.bounties.open + 2);
      assert.equal(after.bounties.completed, before.bounties.completed + 1);
      assert.equal(after.bounties.closed, before.bounties.closed + 1);
      assert.equal(after.bounties.byStatus.pending_fund, before.bounties.byStatus.pending_fund + 1);
      assert.equal(after.bounties.byStatus.funded, before.bounties.byStatus.funded + 1);
      assert.equal(after.bounties.byStatus.settled, before.bounties.byStatus.settled + 1);
      assert.equal(after.bounties.byStatus.refunded, before.bounties.byStatus.refunded + 1);

      const transactedDelta =
        usdcToAtomic(after.volumeUsdc.transacted) - usdcToAtomic(before.volumeUsdc.transacted);
      // funded 100 + settled 50 + refunded 10. pending 25 and fee 1 are excluded.
      assert.equal(transactedDelta, usdcToAtomic("160.000000"));

      const outstandingDelta =
        usdcToAtomic(after.volumeUsdc.outstandingOpen) -
        usdcToAtomic(before.volumeUsdc.outstandingOpen);
      assert.equal(outstandingDelta, usdcToAtomic("100.000000"));

      const completedDelta =
        usdcToAtomic(after.volumeUsdc.completed) - usdcToAtomic(before.volumeUsdc.completed);
      assert.equal(completedDelta, usdcToAtomic("50.000000"));

      assert.equal(after.developers.participated, before.developers.participated + 3);
      assert.equal(after.developers.githubLinked, before.developers.githubLinked + 1);
      assert.equal(after.repos.connected, before.repos.connected + 1);
      assert.equal(after.repos.total, before.repos.total + 2);

      const expected = await expectedFromSql(sql, NOW);
      assert.deepEqual(after.bounties, expected.bounties);
      assert.deepEqual(after.volumeUsdc, expected.volumeUsdc);
      assert.deepEqual(after.developers, expected.developers);
      assert.deepEqual(after.repos, expected.repos);
    } finally {
      await sql`
        delete from allocation_ledger where bounty_id in (
          ${settledId}::uuid
        )
      `;
      await sql`delete from fee_ledger where bounty_id = ${settledId}::uuid`;
      await sql`delete from pool_participants where bounty_id = ${settledId}::uuid`;
      await sql`delete from work_signals where bounty_id = ${fundedId}::uuid`;
      await sql`delete from claim_locks where bounty_id = ${fundedId}::uuid`;
      await sql`delete from claims where bounty_id = ${settledId}::uuid`;
      await sql`
        delete from escrows where bounty_id in (
          ${pendingId}::uuid, ${fundedId}::uuid, ${settledId}::uuid, ${refundedId}::uuid
        )
      `;
      await sql`
        delete from bounties where id in (
          ${pendingId}::uuid, ${fundedId}::uuid, ${settledId}::uuid, ${refundedId}::uuid
        )
      `;
      await sql`
        delete from repos where id in (${repoActiveId}::uuid, ${repoInactiveId}::uuid)
      `;
      await sql`delete from github_links where user_id = ${hunterLinkedId}::uuid`;
      await sql`
        delete from users where id in (
          ${posterId}::uuid,
          ${hunterLinkedId}::uuid,
          ${hunterUnlinkedId}::uuid,
          ${extraRepoOwnerId}::uuid
        )
      `;
      await sql.end({ timeout: 5 });
    }
  });
});

async function expectedFromSql(
  sql: ReturnType<typeof createDb>["sql"],
  now: Date,
) {
  const statusRows = await sql<
    { status: string; n: number; face: string }[]
  >`
    select status, count(*)::int as n, coalesce(sum(amount_usdc), 0)::text as face
    from bounties
    group by status
  `;
  const [volume] = await sql<{ transacted: string }[]>`
    select coalesce(sum(amount_usdc), 0)::text as transacted
    from escrows
    where status in (
      'funded', 'settling', 'settled', 'settled_partial', 'refunding', 'refunded'
    )
  `;
  const [developers] = await sql<{ participated: number; linked: number }[]>`
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
            where user_id is not null and role in ('winner', 'pool', 'overflow')
          )
          union
          select 'gh:' || pp.github_id::text
          from pool_participants pp
          where pp.role in ('winner', 'pool', 'overflow')
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
      (select count(*)::int from github_links) as linked
  `;
  const [repo] = await sql<{ connected: number; total: number }[]>`
    select
      count(*) filter (where is_active)::int as connected,
      count(*)::int as total
    from repos
  `;

  const byStatus: Record<string, number> = {};
  const faceByStatus: Record<string, string> = {};
  for (const row of statusRows) {
    byStatus[row.status] = Number(row.n);
    faceByStatus[row.status] = row.face;
  }

  return assemblePlatformStats(
    {
      byStatus,
      faceByStatus,
      transactedUsdc: volume?.transacted ?? "0",
      developersParticipated: Number(developers?.participated ?? 0),
      developersGithubLinked: Number(developers?.linked ?? 0),
      reposConnected: Number(repo?.connected ?? 0),
      reposTotal: Number(repo?.total ?? 0),
    },
    now,
  );
}
