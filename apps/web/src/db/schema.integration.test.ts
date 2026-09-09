import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { CLAIM_LOCK_HOURS, FEE_BPS } from "../lib/constants";
import { createDb } from "./client";
import { isUniqueViolation } from "./errors";
import { loadDotenvFiles } from "./load-dotenv";

loadDotenvFiles();
import { CLAIM_LOCK_EXPIRES_TRIGGER } from "./meta";
import {
  bounties,
  feeLedger,
  repos,
  users,
} from "./schema";

describe("V1 schema (empty-or-seeded Postgres)", () => {
  it("enforces 72h claim-lock default, 2% fee default, and one active bounty/lock", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const userId = randomUUID();
    const repoId = randomUUID();
    const bountyId = randomUUID();
    const secondBountyId = randomUUID();

    try {
      await db.insert(users).values({
        id: userId,
        googleSub: `test-google-${suffix}`,
        email: `test-${suffix}@example.com`,
        displayName: "Schema Test",
      });

      await db.insert(repos).values({
        id: repoId,
        githubRepoId: BigInt(90_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
        fullName: `test/schema-${suffix}`,
        installationId: BigInt(99),
        connectedByUserId: userId,
      });

      await db.insert(bounties).values({
        id: bountyId,
        repoId,
        githubIssueNumber: 7,
        url: `https://github.com/test/schema-${suffix}/issues/7`,
        posterUserId: userId,
        amountUsdc: "10.000000",
        status: "funded",
        title: "unique-issue test",
      });

      await assert.rejects(
        () =>
          db.insert(bounties).values({
            id: secondBountyId,
            repoId,
            githubIssueNumber: 7,
            url: `https://github.com/test/schema-${suffix}/issues/7`,
            posterUserId: userId,
            amountUsdc: "11.000000",
            status: "pending_fund",
            title: "duplicate active bounty",
          }),
        isUniqueViolation,
      );

      const lockedAt = "2026-01-01T00:00:00.000Z";
      const [lock] = await sql<
        { expires_at: string | Date; locked_at: string | Date }[]
      >`
        insert into claim_locks (bounty_id, hunter_user_id, locked_at)
        values (${bountyId}::uuid, ${userId}::uuid, ${lockedAt}::timestamptz)
        returning expires_at, locked_at
      `;
      assert.ok(lock);
      const hours =
        (new Date(lock.expires_at).getTime() - new Date(lock.locked_at).getTime()) /
        3_600_000;
      assert.equal(hours, CLAIM_LOCK_HOURS);

      await assert.rejects(async () => {
        await sql`
          insert into claim_locks (bounty_id, hunter_user_id)
          values (${bountyId}::uuid, ${userId}::uuid)
        `;
      }, isUniqueViolation);

      const [fee] = await db
        .insert(feeLedger)
        .values({
          bountyId,
          faceUsdc: "10.000000",
          feeUsdc: "0.200000",
        })
        .returning({ feeBps: feeLedger.feeBps });
      assert.equal(fee?.feeBps, FEE_BPS);

      const defaults = await sql<
        { column_name: string; column_default: string | null }[]
      >`
        select column_name, column_default
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'fee_ledger'
          and column_name = 'fee_bps'
      `;
      assert.match(defaults[0]?.column_default ?? "", /200/);

      const lockTrigger = await sql<{ tgname: string }[]>`
        select t.tgname
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        where c.relname = 'claim_locks'
          and not t.tgisinternal
          and t.tgname = ${CLAIM_LOCK_EXPIRES_TRIGGER}
      `;
      assert.equal(lockTrigger[0]?.tgname, CLAIM_LOCK_EXPIRES_TRIGGER);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
