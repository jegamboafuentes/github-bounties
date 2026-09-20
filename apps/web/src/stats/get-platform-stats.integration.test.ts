import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { usdcToAtomic } from "../lib/money";
import { createDb } from "../db/client";
import { loadDatabaseUrl } from "../db/env";
import { loadDotenvFiles } from "../db/load-dotenv";
import {
  allocationLedger,
  bountyStatusValues,
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
  PLATFORM_STATS_BUCKETS,
  PLATFORM_STATS_SCHEMA_VERSION,
  type PlatformStats,
} from "./definitions";
import { getPlatformStats } from "./get-platform-stats";

loadDotenvFiles();

const NOW = new Date("2026-09-20T15:00:00.000Z");
const USDC = /^\d+\.\d{6}$/;
const migrationsFolder = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../drizzle");

function assertPlatformStatsShape(stats: PlatformStats) {
  assert.equal(stats.ok, true);
  assert.equal(stats.schemaVersion, PLATFORM_STATS_SCHEMA_VERSION);
  assert.equal(stats.generatedAt, NOW.toISOString());
  assert.equal(stats.product, "GitHub Bounties");
  assert.equal(stats.currency, "USDC");
  assert.deepEqual(stats.buckets, PLATFORM_STATS_BUCKETS);
  assert.deepEqual(Object.keys(stats.bounties.byStatus).sort(), [...bountyStatusValues].sort());
  const bucketSum =
    stats.bounties.open +
    stats.bounties.completed +
    stats.bounties.closed +
    stats.bounties.inFlight;
  assert.equal(stats.bounties.total, bucketSum);
  assert.equal(
    stats.bounties.total,
    bountyStatusValues.reduce((acc, status) => acc + stats.bounties.byStatus[status], 0),
  );
  for (const value of Object.values(stats.volumeUsdc)) {
    assert.match(value, USDC);
  }
  assert.ok(stats.developers.participated >= 0);
  assert.ok(stats.developers.githubLinked >= 0);
  assert.ok(stats.repos.connected >= 0);
  assert.ok(stats.repos.total >= stats.repos.connected);
}

describe("getPlatformStats (empty-or-seeded Postgres)", () => {
  it("returns zeros on a freshly migrated empty database", async () => {
    const admin = createDb();
    const dbName = `gb_stats_empty_${randomUUID().slice(0, 8)}`;
    const baseUrl = new URL(loadDatabaseUrl());
    baseUrl.pathname = `/${dbName}`;
    const emptyUrl = baseUrl.toString();

    try {
      await admin.sql.unsafe(`create database ${dbName}`);
      const empty = createDb(emptyUrl);
      try {
        await migrate(empty.db, { migrationsFolder });
        const stats = await getPlatformStats(empty.db, NOW);
        assertPlatformStatsShape(stats);
        assert.deepEqual(stats, assemblePlatformStats(emptyPlatformStatsAggregates(), NOW));
      } finally {
        await empty.sql.end({ timeout: 5 });
      }
    } finally {
      await admin.sql.unsafe(`drop database if exists ${dbName}`);
      await admin.sql.end({ timeout: 5 });
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
      assertPlatformStatsShape(after);

      const fixtureStatuses = await sql<{ status: string; n: number }[]>`
        select status, count(*)::int as n
        from bounties
        where id in (
          ${pendingId}::uuid, ${fundedId}::uuid, ${settledId}::uuid, ${refundedId}::uuid
        )
        group by status
      `;
      const byFixture = Object.fromEntries(fixtureStatuses.map((row) => [row.status, Number(row.n)]));
      assert.equal(byFixture.pending_fund, 1);
      assert.equal(byFixture.funded, 1);
      assert.equal(byFixture.settled, 1);
      assert.equal(byFixture.refunded, 1);

      const [fixtureVolume] = await sql<{ transacted: string; pending: string; fees: string }[]>`
        select
          coalesce(sum(amount_usdc) filter (
            where status in (
              'funded', 'settling', 'settled', 'settled_partial', 'refunding', 'refunded'
            )
          ), 0)::text as transacted,
          coalesce(sum(amount_usdc) filter (where status in ('pending', 'failed')), 0)::text as pending,
          (
            select coalesce(sum(fee_usdc), 0)::text from fee_ledger
            where bounty_id in (
              ${pendingId}::uuid, ${fundedId}::uuid, ${settledId}::uuid, ${refundedId}::uuid
            )
          ) as fees
        from escrows
        where bounty_id in (
          ${pendingId}::uuid, ${fundedId}::uuid, ${settledId}::uuid, ${refundedId}::uuid
        )
      `;
      // funded 100 + settled 50 + refunded 10. pending 25 and fee 1 are excluded.
      assert.equal(usdcToAtomic(fixtureVolume?.transacted ?? "0"), usdcToAtomic("160.000000"));
      assert.equal(usdcToAtomic(fixtureVolume?.pending ?? "0"), usdcToAtomic("25.000000"));
      assert.equal(usdcToAtomic(fixtureVolume?.fees ?? "0"), usdcToAtomic("1.000000"));

      const [fixtureOutstanding] = await sql<{ open_face: string; completed_face: string }[]>`
        select
          coalesce(sum(amount_usdc) filter (where status in ('funded', 'claim_locked')), 0)::text as open_face,
          coalesce(sum(amount_usdc) filter (where status in ('settled', 'settled_partial')), 0)::text as completed_face
        from bounties
        where id in (
          ${pendingId}::uuid, ${fundedId}::uuid, ${settledId}::uuid, ${refundedId}::uuid
        )
      `;
      assert.equal(usdcToAtomic(fixtureOutstanding?.open_face ?? "0"), usdcToAtomic("100.000000"));
      assert.equal(usdcToAtomic(fixtureOutstanding?.completed_face ?? "0"), usdcToAtomic("50.000000"));

      const [fixtureDevs] = await sql<{ n: number }[]>`
        select count(*)::int as n from (
          select 'gh:' || gl.github_id::text as hid
          from github_links gl
          where gl.user_id in (
            select hunter_user_id from claims where bounty_id = ${settledId}::uuid
            union
            select hunter_user_id from claim_locks where bounty_id = ${fundedId}::uuid
          )
          union
          select 'gh:' || pp.github_id::text
          from pool_participants pp
          where pp.bounty_id = ${settledId}::uuid
            and pp.role in ('winner', 'pool', 'overflow')
          union
          select 'user:' || ws.user_id::text
          from work_signals ws
          where ws.bounty_id = ${fundedId}::uuid
            and not exists (
              select 1 from github_links gl where gl.user_id = ws.user_id
            )
        ) hunters
      `;
      assert.equal(Number(fixtureDevs?.n), 3);

      const [fixtureRepos] = await sql<{ connected: number; total: number }[]>`
        select
          count(*) filter (where is_active)::int as connected,
          count(*)::int as total
        from repos
        where id in (${repoActiveId}::uuid, ${repoInactiveId}::uuid)
      `;
      assert.equal(Number(fixtureRepos?.connected), 1);
      assert.equal(Number(fixtureRepos?.total), 2);
      assert.ok(usdcToAtomic(after.volumeUsdc.transacted) >= usdcToAtomic("160.000000"));
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
