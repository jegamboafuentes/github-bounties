import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createBountyFromIssueUrl } from "../bounties/create";
import { fundBounty } from "../bounties/fund";
import { getBoardBounty, listBoardBounties } from "../bounties/list";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { updateBountyAmount } from "../bounties/update-amount";
import { BountyError } from "../bounties/errors";
import { claimPayout } from "../claims/payout";
import { ClaimError } from "../claims/errors";
import { adminAuditLog, bounties, claims, escrows, feeLedger, platformSettings, users, repos } from "../db/schema";
import { VOIDED_UNFUNDED_CODE } from "../escrow/fail";
import { createMockRail } from "../escrow/rail";
import { probeCdpEnv } from "../escrow/env";
import { settleEscrow } from "../escrow/service";
import { getPlatformStats } from "../stats/get-platform-stats";
import { expectedEscrowLiabilitiesAtomic } from "./balances";
import { softDeleteBounty } from "./delete";
import { AdminError } from "./errors";
import { adminRefundBounty } from "./refund";
import { setPlatformFee, setPlatformFeeBps, setPlatformPool, setPlatformPoolBps, readPlatformSettings } from "./settings";

loadDotenvFiles();

const HUNTER = "0x1111111111111111111111111111111111111111";

async function fixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const hunterId = randomUUID();
  const fullName = `test/admin-${suffix}`;
  await db.insert(users).values([
    {
      id: posterId,
      googleSub: `poster-admin-${suffix}`,
      email: `poster-admin-${suffix}@example.com`,
      displayName: "Ada",
      walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    {
      id: hunterId,
      googleSub: `hunter-admin-${suffix}`,
      email: `hunter-admin-${suffix}@example.com`,
      displayName: "Hunter",
      walletAddress: HUNTER,
    },
  ]);
  await db.insert(repos).values({
    id: randomUUID(),
    githubRepoId: BigInt(90_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
    fullName,
    installationId: BigInt(9014),
    connectedByUserId: posterId,
    isActive: true,
  });
  return { db, sql, posterId, hunterId, fullName };
}

async function post(
  db: Awaited<ReturnType<typeof fixture>>["db"],
  posterId: string,
  fullName: string,
  n: number,
) {
  return createBountyFromIssueUrl(
    {
      posterUserId: posterId,
      issueUrl: `https://github.com/${fullName}/issues/${n}`,
      amountUsdc: "100",
    },
    { db, fetchIssueSnapshot: async () => null },
  );
}

describe("admin settings, stamping, and soft delete", () => {
  it("stamps new bounties from settings and settles the old bounty at 200 after the fee moves to 500", async () => {
    const { db, sql, posterId, hunterId, fullName } = await fixture();
    const rail = createMockRail(probeCdpEnv({}));
    try {
      await setPlatformFeeBps(db, "admin@example.com", 200);
      const first = await post(db, posterId, fullName, 1);
      const [stamped] = await db.select().from(bounties).where(eq(bounties.id, first.id));
      assert.equal(stamped?.feeBps, 200);
      assert.equal(stamped?.participationPoolBps, 1500);

      await setPlatformFeeBps(db, "admin@example.com", 500);
      const second = await post(db, posterId, fullName, 2);
      const [later] = await db.select().from(bounties).where(eq(bounties.id, second.id));
      assert.equal(later?.feeBps, 500);
      const [still] = await db.select().from(bounties).where(eq(bounties.id, first.id));
      assert.equal(still?.feeBps, 200);

      await fundBounty(first.id, posterId, db, new Date(), { rail });
      await db.insert(claims).values({
        bountyId: first.id,
        hunterUserId: hunterId,
        status: "eligible",
        prNumber: 1,
        payoutAddress: HUNTER,
      });
      const settled = await settleEscrow(first.id, { actorUserId: posterId, scope: "winner_and_fee" }, { db, rail });
      assert.equal(settled.feeBps, 200);
      const [fee] = await db.select().from(feeLedger).where(eq(feeLedger.bountyId, first.id));
      assert.equal(fee?.feeBps, 200);
      assert.equal(fee?.feeUsdc, "2.000000");
    } finally {
      await setPlatformFeeBps(db, "admin@example.com", 200).catch(() => undefined);
      await sql.end({ timeout: 5 });
    }
  });

  it("refuses a funded delete and hides an unfunded delete from the board and stats", async () => {
    const { db, sql, posterId, fullName } = await fixture();
    const rail = createMockRail(probeCdpEnv({}));
    try {
      const open = await post(db, posterId, fullName, 3);
      await softDeleteBounty({ bountyId: open.id, actorEmail: "Admin@Example.com", db });
      const [voided] = await db.select().from(bounties).where(eq(bounties.id, open.id));
      assert.equal(voided?.status, "cancelled");
      assert.ok(voided?.deletedAt);
      const [voidedEscrow] = await db.select().from(escrows).where(eq(escrows.bountyId, open.id));
      assert.equal(voidedEscrow?.status, "failed");
      assert.equal(voidedEscrow?.failCode, VOIDED_UNFUNDED_CODE);
      await assert.rejects(
        () =>
          updateBountyAmount({
            bountyId: open.id,
            actorUserId: posterId,
            amountUsdc: "11",
            source: "rest",
            db,
          }),
        (err: unknown) => err instanceof BountyError && err.code === "bounty_not_found",
      );
      await assert.rejects(
        () => claimPayout(open.id, posterId, { payoutAddress: HUNTER }, { db }),
        (err: unknown) => err instanceof ClaimError && err.code === "bounty_not_found",
      );
      assert.equal(await getBoardBounty(open.id, db), null);
      const listed = await listBoardBounties(db, { repo: fullName });
      assert.equal(listed.some((row) => row.id === open.id), false);
      const after = await getPlatformStats(db);
      assert.match(after.volumeUsdc.transacted, /^\d+\.\d{6}$/);
      const owed = await expectedEscrowLiabilitiesAtomic(db);
      assert.equal(typeof owed, "bigint");

      const funded = await post(db, posterId, fullName, 4);
      await fundBounty(funded.id, posterId, db, new Date(), { rail });
      const [fundedBefore] = await db
        .select({ updatedAt: bounties.updatedAt, deletedAt: bounties.deletedAt })
        .from(bounties)
        .where(eq(bounties.id, funded.id));
      await assert.rejects(
        () => softDeleteBounty({ bountyId: funded.id, actorEmail: "admin@example.com", db }),
        (err: unknown) => err instanceof AdminError && err.code === "bounty_has_funds_refund_first",
      );
      const [fundedAfter] = await db
        .select({ updatedAt: bounties.updatedAt, deletedAt: bounties.deletedAt, status: bounties.status })
        .from(bounties)
        .where(eq(bounties.id, funded.id));
      assert.equal(fundedAfter?.deletedAt, null);
      assert.equal(fundedAfter?.status, "funded");
      assert.equal(fundedAfter?.updatedAt?.getTime(), fundedBefore?.updatedAt?.getTime());
      const [refusal] = await db
        .select()
        .from(adminAuditLog)
        .where(eq(adminAuditLog.target, funded.id));
      assert.equal(refusal?.result, "refused");
      assert.equal((refusal?.after as { reason?: string } | null)?.reason, "escrow_holds_funds");

      for (const [issue, status] of [
        [5, "cancelled"],
        [6, "settled"],
      ] as const) {
        const draft = await post(db, posterId, fullName, issue);
        await db.update(bounties).set({ status }).where(eq(bounties.id, draft.id));
        if (status === "cancelled") {
          await db
            .update(escrows)
            .set({ status: "failed", failCode: VOIDED_UNFUNDED_CODE })
            .where(eq(escrows.bountyId, draft.id));
        }
        const removed = await softDeleteBounty({ bountyId: draft.id, actorEmail: "admin@example.com", db });
        assert.ok(removed.deletedAt);
        assert.equal(await getBoardBounty(draft.id, db), null);
      }

      const rates = await readPlatformSettings(db);
      const same = await setPlatformPoolBps(db, "admin@example.com", rates.poolBps);
      assert.equal(same.poolBps, rates.poolBps);
      assert.equal(same.updatedAt?.getTime(), rates.updatedAt?.getTime());
      await assert.rejects(
        () => setPlatformPool(db, "admin@example.com", { poolPercent: "" }),
        (err: unknown) => err instanceof AdminError && err.code === "invalid_pool_bps",
      );
      await assert.rejects(
        () => setPlatformFee(db, "admin@example.com", { feePercent: " " }),
        (err: unknown) => err instanceof AdminError && err.code === "invalid_fee_bps",
      );
      const unchanged = await readPlatformSettings(db);
      assert.equal(unchanged.poolBps, rates.poolBps);
      assert.equal(unchanged.feeBps, rates.feeBps);
      const settings = await readPlatformSettings(db);
      assert.equal(settings.feeBps >= 0, true);
      const [row] = await db.select().from(platformSettings).limit(1);
      assert.ok(row);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("refunds a funded bounty through the existing flow only when ADMIN_REFUND_ENABLED=1", async () => {
    const { db, sql, posterId, fullName } = await fixture();
    const rail = createMockRail(probeCdpEnv({}));
    const envOff = { API_MONEY_ENABLED: "0", ADMIN_REFUND_ENABLED: "0", CDP_NETWORK: "base-sepolia" };
    const envOn = { API_MONEY_ENABLED: "0", ADMIN_REFUND_ENABLED: "1", CDP_NETWORK: "base-sepolia" };
    try {
      const funded = await post(db, posterId, fullName, 40);
      await fundBounty(funded.id, posterId, db, new Date(), { rail });

      await assert.rejects(
        () =>
          adminRefundBounty({
            bountyId: "not-a-uuid",
            actorEmail: "admin@example.com",
            db,
            env: envOff,
            rail,
          }),
        (err: unknown) => err instanceof AdminError && err.status === 404 && err.code === "not_found",
      );
      const missingId = randomUUID();
      await assert.rejects(
        () =>
          adminRefundBounty({
            bountyId: missingId,
            actorEmail: "admin@example.com",
            db,
            env: envOff,
            rail,
          }),
        (err: unknown) => err instanceof AdminError && err.status === 404 && err.code === "not_found",
      );
      const stray = await db.select().from(adminAuditLog).where(eq(adminAuditLog.target, missingId));
      assert.equal(stray.length, 0);

      const draft = await post(db, posterId, fullName, 41);
      await softDeleteBounty({ bountyId: draft.id, actorEmail: "admin@example.com", db });
      await assert.rejects(
        () =>
          adminRefundBounty({
            bountyId: draft.id,
            actorEmail: "Admin@Example.com",
            db,
            env: envOn,
            rail,
          }),
        (err: unknown) => err instanceof AdminError && err.status === 410 && err.code === "not_found",
      );
      const deletedAudits = await db.select().from(adminAuditLog).where(eq(adminAuditLog.target, draft.id));
      const deletedAudit = deletedAudits.find((row) => row.action === "refund_bounty");
      assert.equal(deletedAudit?.result, "refused");
      assert.equal((deletedAudit?.after as { reason?: string } | null)?.reason, "deleted");

      await assert.rejects(
        () =>
          adminRefundBounty({
            bountyId: funded.id,
            actorEmail: "Admin@Example.com",
            db,
            env: envOff,
            rail,
          }),
        (err: unknown) => err instanceof AdminError && err.status === 403 && err.code === "admin_refund_disabled",
      );
      const [stillFunded] = await db.select({ status: bounties.status }).from(bounties).where(eq(bounties.id, funded.id));
      assert.equal(stillFunded?.status, "funded");
      const [refused] = await db
        .select()
        .from(adminAuditLog)
        .where(eq(adminAuditLog.target, funded.id));
      assert.equal(refused?.result, "refused");
      assert.equal((refused?.after as { reason?: string } | null)?.reason, "admin_refund_disabled");

      const refunded = await adminRefundBounty({
        bountyId: funded.id,
        actorEmail: "admin@example.com",
        db,
        env: envOn,
        rail,
      });
      assert.equal(refunded.status, "cancelled");
      assert.match(refunded.refundTxHash ?? "", /^mock:/);
      const [after] = await db.select({ status: bounties.status }).from(bounties).where(eq(bounties.id, funded.id));
      assert.equal(after?.status, "cancelled");
      const audits = await db.select().from(adminAuditLog).where(eq(adminAuditLog.target, funded.id));
      assert.equal(audits.some((row) => row.result === "ok" && row.action === "refund_bounty"), true);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
