import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { POOL_BPS_OF_POST_FEE, POOL_MAX_PAID } from "../lib/constants";
import { splitPostFeePool, usdcToAtomic } from "../lib/money";
import { frozenSetConservesFace, ledgerConservesFace } from "../lib/pool-invariants";
import { createDb } from "./client";
import { isUniqueViolation } from "./errors";
import { loadDotenvFiles } from "./load-dotenv";
import {
  allocationLedger,
  allocationLedgerKindValues,
  allocationLedgerStatusValues,
  bounties,
  claims,
  escrows,
  poolParticipantRoleValues,
  poolParticipants,
  repos,
  users,
  workSignals,
} from "./schema";
import { SEED_V2 } from "./seed-v2-pool";

loadDotenvFiles();

async function insertBountyFixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const hunterId = randomUUID();
  const repoId = randomUUID();
  const bountyId = randomUUID();

  await db.insert(users).values([
    {
      id: userId,
      googleSub: `pool-poster-${suffix}`,
      email: `pool-poster-${suffix}@example.com`,
      displayName: "Pool Poster",
    },
    {
      id: hunterId,
      googleSub: `pool-hunter-${suffix}`,
      email: `pool-hunter-${suffix}@example.com`,
      displayName: "Pool Hunter",
    },
  ]);
  await db.insert(repos).values({
    id: repoId,
    githubRepoId: BigInt(80_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
    fullName: `test/pool-${suffix}`,
    installationId: BigInt(77),
    connectedByUserId: userId,
  });
  await db.insert(bounties).values({
    id: bountyId,
    repoId,
    githubIssueNumber: 90,
    url: `https://github.com/test/pool-${suffix}/issues/90`,
    posterUserId: userId,
    amountUsdc: "100.000000",
    status: "funded",
    title: "V2-1 schema fixture",
  });

  return { db, sql, userId, hunterId, bountyId, suffix };
}

describe("V2-1 pool schema", () => {
  it("defaults participation_pool_bps to 1500 (15% of post-fee)", async () => {
    const { db, sql, bountyId } = await insertBountyFixture();
    try {
      const [row] = await db
        .select({ bps: bounties.participationPoolBps })
        .from(bounties)
        .where(eq(bounties.id, bountyId));
      assert.equal(row?.bps, POOL_BPS_OF_POST_FEE);
      assert.equal(row?.bps, 1500);

      const defaults = await sql<
        { column_default: string | null }[]
      >`
        select column_default
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'bounties'
          and column_name = 'participation_pool_bps'
      `;
      assert.match(defaults[0]?.column_default ?? "", /1500/);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("keeps the V1 exclusive claim_locks unique index and does not add one on work_signals", async () => {
    const { sql } = createDb();
    try {
      const lockIdx = await sql<{ indexdef: string }[]>`
        select pg_get_indexdef(i.oid) as indexdef
        from pg_class t
        join pg_index x on x.indrelid = t.oid
        join pg_class i on i.oid = x.indexrelid
        where t.relname = 'claim_locks'
          and i.relname = 'claim_locks_one_active_per_bounty_uidx'
      `;
      assert.equal(lockIdx.length, 1);
      assert.match(lockIdx[0]?.indexdef ?? "", /UNIQUE/i);

      const signalUnique = await sql<{ relname: string }[]>`
        select i.relname
        from pg_class t
        join pg_index x on x.indrelid = t.oid
        join pg_class i on i.oid = x.indexrelid
        where t.relname = 'work_signals'
          and x.indisunique
          and not x.indisprimary
      `;
      assert.equal(signalUnique.length, 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("enforces unique (bounty_id, github_id) and allows many work_signals", async () => {
    const { db, sql, bountyId, hunterId } = await insertBountyFixture();
    try {
      await db.insert(poolParticipants).values({
        bountyId,
        githubId: BigInt(42),
        githubLogin: "alice",
        userId: hunterId,
        role: "pool",
        shareUsdc: "7.350000",
      });
      await assert.rejects(
        () =>
          db.insert(poolParticipants).values({
            bountyId,
            githubId: BigInt(42),
            githubLogin: "alice-dupe",
            role: "pool",
            shareUsdc: "7.350000",
          }),
        isUniqueViolation,
      );

      await db.insert(workSignals).values([
        { bountyId, userId: hunterId },
        { bountyId, userId: hunterId },
      ]);
      const signals = await db
        .select({ id: workSignals.id })
        .from(workSignals)
        .where(eq(workSignals.bountyId, bountyId));
      assert.equal(signals.length, 2);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("enforces unique (bounty_id, kind, participant_id) including null FEE_OUT", async () => {
    const { db, sql, bountyId, hunterId } = await insertBountyFixture();
    try {
      const [winner] = await db
        .insert(poolParticipants)
        .values({
          bountyId,
          githubId: BigInt(7),
          githubLogin: "winner",
          userId: hunterId,
          role: "winner",
          shareUsdc: "83.300000",
        })
        .returning({ id: poolParticipants.id });

      await db.insert(allocationLedger).values({
        bountyId,
        participantId: null,
        kind: "FEE_OUT",
        amountUsdc: "2.000000",
        idempotencyKey: `test-fee-${bountyId}`,
        status: "pending",
      });
      await assert.rejects(
        () =>
          db.insert(allocationLedger).values({
            bountyId,
            participantId: null,
            kind: "FEE_OUT",
            amountUsdc: "2.000000",
            idempotencyKey: `test-fee-dupe-${bountyId}`,
            status: "pending",
          }),
        isUniqueViolation,
      );

      await db.insert(allocationLedger).values({
        bountyId,
        participantId: winner?.id,
        kind: "WINNER_PAYOUT",
        amountUsdc: "83.300000",
        idempotencyKey: `test-winner-${bountyId}`,
        status: "pending",
      });
      await assert.rejects(
        () =>
          db.insert(allocationLedger).values({
            bountyId,
            participantId: winner?.id,
            kind: "WINNER_PAYOUT",
            amountUsdc: "83.300000",
            idempotencyKey: `test-winner-dupe-${bountyId}`,
            status: "pending",
          }),
        isUniqueViolation,
      );
      await assert.rejects(
        () =>
          db.insert(allocationLedger).values({
            bountyId,
            participantId: winner?.id,
            kind: "POOL_PAYOUT",
            amountUsdc: "1.000000",
            idempotencyKey: `test-winner-${bountyId}`,
            status: "pending",
          }),
        isUniqueViolation,
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("locks role / kind / status enums", () => {
    assert.deepEqual(poolParticipantRoleValues, [
      "winner",
      "pool",
      "overflow",
      "excluded_poster",
      "excluded_bot",
    ]);
    assert.deepEqual(allocationLedgerKindValues, [
      "FEE_OUT",
      "WINNER_PAYOUT",
      "POOL_PAYOUT",
    ]);
    assert.deepEqual(allocationLedgerStatusValues, [
      "pending",
      "submitted",
      "confirmed",
      "failed",
    ]);
  });
});

describe("V2-1 seed fixtures", () => {
  it("2-hunter pool conserves F; claims winner-only; escrow hash is the winner hash", async () => {
    const { db, sql } = createDb();
    try {
      const participants = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, SEED_V2.twoHunterBountyId));
      const legs = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, SEED_V2.twoHunterBountyId));
      const claimRows = await db
        .select()
        .from(claims)
        .where(eq(claims.bountyId, SEED_V2.twoHunterBountyId));
      const [escrow] = await db
        .select()
        .from(escrows)
        .where(eq(escrows.bountyId, SEED_V2.twoHunterBountyId));
      const signals = await db
        .select()
        .from(workSignals)
        .where(eq(workSignals.bountyId, SEED_V2.twoHunterBountyId));
      const [bounty] = await db
        .select()
        .from(bounties)
        .where(eq(bounties.id, SEED_V2.twoHunterBountyId));

      assert.equal(bounty?.participationPoolBps, 1500);
      assert.equal(bounty?.status, "funded");
      frozenSetConservesFace(
        "100.000000",
        participants.map((row) => ({ role: row.role, shareUsdc: row.shareUsdc })),
      );
      ledgerConservesFace(
        "100.000000",
        legs.map((row) => ({ kind: row.kind, amountUsdc: row.amountUsdc })),
      );
      assert.equal(claimRows.length, 1);
      assert.equal(claimRows[0]?.prAuthorLogin, "octocat");
      assert.equal(participants.filter((row) => row.role === "pool").length, 2);
      const winner = participants.find((row) => row.role === "winner");
      assert.equal(escrow?.payoutTxHash, winner?.payoutTxHash);
      assert.notEqual(
        escrow?.payoutTxHash,
        participants.find((row) => row.githubLogin === "alice")?.payoutTxHash,
      );
      assert.ok(signals.length >= 3);
      const aliceSignals = signals.filter((row) => row.userId === SEED_V2.aliceId);
      assert.ok(aliceSignals.length >= 2);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("11th overflow has share 0 and no POOL_PAYOUT row", async () => {
    const { db, sql } = createDb();
    try {
      const participants = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, SEED_V2.overflowBountyId));
      const legs = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, SEED_V2.overflowBountyId));
      const overflow = participants.filter((row) => row.role === "overflow");
      const pool = participants.filter((row) => row.role === "pool");
      assert.equal(pool.length, POOL_MAX_PAID);
      assert.equal(overflow.length, 1);
      assert.equal(usdcToAtomic(overflow[0]?.shareUsdc ?? "1"), 0n);
      assert.equal(overflow[0]?.skipReason, "overflow");
      assert.equal(legs.filter((row) => row.kind === "POOL_PAYOUT").length, 10);
      assert.equal(
        legs.some((row) => row.participantId === overflow[0]?.id),
        false,
      );
      frozenSetConservesFace(
        "100.000000",
        participants.map((row) => ({ role: row.role, shareUsdc: row.shareUsdc })),
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("empty-pool regression: fee + winner = F and no POOL_PAYOUT", async () => {
    const { db, sql } = createDb();
    try {
      const participants = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, SEED_V2.emptyPoolBountyId));
      const legs = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, SEED_V2.emptyPoolBountyId));
      const split = splitPostFeePool("100.000000", 0);
      assert.equal(participants.length, 1);
      assert.equal(participants[0]?.role, "winner");
      assert.equal(participants[0]?.shareUsdc, split.winnerUsdc);
      assert.equal(legs.filter((row) => row.kind === "POOL_PAYOUT").length, 0);
      frozenSetConservesFace(
        "100.000000",
        participants.map((row) => ({ role: row.role, shareUsdc: row.shareUsdc })),
      );
      ledgerConservesFace(
        "100.000000",
        legs.map((row) => ({ kind: row.kind, amountUsdc: row.amountUsdc })),
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("persists excluded poster (and bot) with zero share", async () => {
    const { db, sql } = createDb();
    try {
      const participants = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, SEED_V2.posterExcludedBountyId));
      const poster = participants.find((row) => row.role === "excluded_poster");
      const bot = participants.find((row) => row.role === "excluded_bot");
      assert.equal(poster?.githubLogin, "ada-maintainer");
      assert.equal(usdcToAtomic(poster?.shareUsdc ?? "1"), 0n);
      assert.equal(poster?.skipReason, "poster");
      assert.equal(bot?.skipReason, "bot");
      assert.equal(usdcToAtomic(bot?.shareUsdc ?? "1"), 0n);
      frozenSetConservesFace(
        "100.000000",
        participants.map((row) => ({ role: row.role, shareUsdc: row.shareUsdc })),
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("persists unlinked github_id with null user_id and hunter_not_linked", async () => {
    const { db, sql } = createDb();
    try {
      const participants = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, SEED_V2.unlinkedBountyId));
      const unlinked = participants.find((row) => row.role === "pool");
      assert.equal(unlinked?.userId, null);
      assert.equal(unlinked?.githubId, BigInt(SEED_V2.unlinkedGithubId));
      assert.equal(unlinked?.skipReason, "hunter_not_linked");
      assert.ok(usdcToAtomic(unlinked?.shareUsdc ?? "0") > 0n);
      const claimRows = await db
        .select()
        .from(claims)
        .where(eq(claims.bountyId, SEED_V2.unlinkedBountyId));
      assert.equal(claimRows.length, 1);
      frozenSetConservesFace(
        "100.000000",
        participants.map((row) => ({ role: row.role, shareUsdc: row.shareUsdc })),
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
