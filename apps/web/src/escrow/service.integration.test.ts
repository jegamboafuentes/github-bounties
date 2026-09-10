import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, claims, escrows, feeLedger, repos, users } from "../db/schema";
import { createBountyFromIssueUrl } from "../bounties/create";
import { fundBounty } from "../bounties/fund";
import { createMockRail, MOCK_FEE_ADDRESS } from "./rail";
import { expireUnmergedBounties, refundEscrow, settleEscrow } from "./service";
import { probeCdpEnv } from "./env";

loadDotenvFiles();

const HUNTER_ADDRESS = "0x00000000000000000000000000000000h007e4";

async function fixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const hunterId = randomUUID();
  const repoId = randomUUID();
  const fullName = `test/escrow-${suffix}`;
  const githubRepoId = BigInt(80_000_000 + Number.parseInt(suffix.slice(0, 6), 16));

  await db.insert(users).values([
    {
      id: posterId,
      googleSub: `poster-${suffix}`,
      email: `poster-${suffix}@example.com`,
      displayName: "Ada Poster",
      walletAddress: "0x00000000000000000000000000000000f00d01",
    },
    {
      id: hunterId,
      googleSub: `hunter-${suffix}`,
      email: `hunter-${suffix}@example.com`,
      displayName: "Hunter One",
      walletAddress: HUNTER_ADDRESS,
    },
  ]);
  await db.insert(repos).values({
    id: repoId,
    githubRepoId,
    fullName,
    installationId: BigInt(9002),
    connectedByUserId: posterId,
    isActive: true,
  });

  const rail = createMockRail(probeCdpEnv({}));
  return { db, sql, suffix, posterId, hunterId, fullName, rail };
}

async function postBounty(
  db: ReturnType<typeof createDb>["db"],
  posterId: string,
  fullName: string,
  issue: number,
  amount = "100",
) {
  return createBountyFromIssueUrl(
    {
      posterUserId: posterId,
      issueUrl: `https://github.com/${fullName}/issues/${issue}`,
      amountUsdc: amount,
    },
    { db, fetchIssueSnapshot: async () => null },
  );
}

describe("V1-5 escrow fund / settle / refund (mock rail)", () => {
  it("locks pending → funded with a mock fund hash and missing CDP env", async () => {
    const { db, sql, posterId, fullName, rail } = await fixture();
    try {
      const created = await postBounty(db, posterId, fullName, 21);
      const [before] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(before?.status, "pending");

      const funded = await fundBounty(created.id, posterId, db, new Date(), { rail });
      assert.equal(funded.status, "funded");
      assert.equal(funded.rail, "mock");
      assert.ok(funded.fundTxHash?.startsWith("mock:"));
      assert.ok(funded.missingEnv?.includes("CDP_API_KEY_ID"));
      assert.ok(funded.missingEnv?.includes("CDP_WALLET_SECRET"));

      const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(escrow?.status, "funded");
      assert.equal(escrow?.fundTxHash, funded.fundTxHash);
      assert.ok(escrow?.idempotencyKey);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("settles hunter 98% + fee 2% with hashes and a FeeLedger row (idempotent)", async () => {
    const { db, sql, posterId, hunterId, fullName, rail } = await fixture();
    try {
      const created = await postBounty(db, posterId, fullName, 22);
      await fundBounty(created.id, posterId, db, new Date(), { rail });

      const first = await settleEscrow(
        created.id,
        {
          actorUserId: posterId,
          hunterUserId: hunterId,
          hunterPayoutAddress: HUNTER_ADDRESS,
        },
        { db, rail },
      );
      assert.equal(first.bountyStatus, "settled");
      assert.equal(first.escrowStatus, "settled");
      assert.equal(first.hunterUsdc, "98.000000");
      assert.equal(first.feeUsdc, "2.000000");
      assert.equal(first.feeBps, 200);
      assert.ok(first.payoutTxHash?.startsWith("mock:"));
      assert.ok(first.feeTxHash?.startsWith("mock:"));
      assert.equal(first.feeAddress, MOCK_FEE_ADDRESS);

      const [fee] = await db.select().from(feeLedger).where(eq(feeLedger.bountyId, created.id));
      assert.equal(fee?.feeUsdc, "2.000000");
      assert.equal(fee?.feeBps, 200);
      assert.ok(fee?.settledAt);

      const second = await settleEscrow(
        created.id,
        { actorUserId: posterId, hunterUserId: hunterId, hunterPayoutAddress: HUNTER_ADDRESS },
        { db, rail },
      );
      assert.equal(second.payoutTxHash, first.payoutTxHash);
      assert.equal(second.feeTxHash, first.feeTxHash);

      const fees = await db.select().from(feeLedger).where(eq(feeLedger.bountyId, created.id));
      assert.equal(fees.length, 1);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("retries FEE_OUT only after SettledPartial", async () => {
    const { db, sql, posterId, hunterId, fullName } = await fixture();
    const failFeeOnce = createMockRail(probeCdpEnv({}));
    let feeCalls = 0;
    const orig = failFeeOnce.transferUsdc.bind(failFeeOnce);
    failFeeOnce.transferUsdc = async (input) => {
      if (input.purpose === "fee") {
        feeCalls += 1;
        if (feeCalls === 1) {
          throw new Error("simulated fee drop");
        }
      }
      return orig(input);
    };
    try {
      const created = await postBounty(db, posterId, fullName, 23);
      await fundBounty(created.id, posterId, db, new Date(), { rail: failFeeOnce });
      const partial = await settleEscrow(
        created.id,
        { actorUserId: posterId, hunterUserId: hunterId, hunterPayoutAddress: HUNTER_ADDRESS },
        { db, rail: failFeeOnce },
      );
      assert.equal(partial.bountyStatus, "settled_partial");
      assert.ok(partial.payoutTxHash);
      assert.equal(partial.feeTxHash, null);

      const retried = await settleEscrow(
        created.id,
        { actorUserId: posterId, hunterUserId: hunterId, hunterPayoutAddress: HUNTER_ADDRESS },
        { db, rail: failFeeOnce },
      );
      assert.equal(retried.bountyStatus, "settled");
      assert.equal(retried.payoutTxHash, partial.payoutTxHash);
      assert.ok(retried.feeTxHash?.startsWith("mock:"));
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("refunds full face on poster cancel and on expires_at (no fee)", async () => {
    const { db, sql, posterId, fullName, rail } = await fixture();
    try {
      const cancellable = await postBounty(db, posterId, fullName, 24, "40");
      await fundBounty(cancellable.id, posterId, db, new Date(), { rail });
      const cancelled = await refundEscrow(
        cancellable.id,
        { actorUserId: posterId, reason: "cancel" },
        { db, rail },
      );
      assert.equal(cancelled.bountyStatus, "cancelled");
      assert.equal(cancelled.escrowStatus, "refunded");
      assert.ok(cancelled.refundTxHash?.startsWith("mock:"));
      const fees = await db.select().from(feeLedger).where(eq(feeLedger.bountyId, cancellable.id));
      assert.equal(fees.length, 0);

      const expiring = await postBounty(db, posterId, fullName, 25, "15");
      await fundBounty(expiring.id, posterId, db, new Date(), { rail });
      const past = new Date("2020-01-01T00:00:00.000Z");
      await db.update(bounties).set({ expiresAt: past }).where(eq(bounties.id, expiring.id));
      const expired = await expireUnmergedBounties({ db, rail, now: new Date("2026-09-10T00:00:00.000Z") });
      assert.ok(expired.refundedBountyIds.includes(expiring.id));
      const [row] = await db.select({ status: bounties.status }).from(bounties).where(eq(bounties.id, expiring.id));
      assert.equal(row?.status, "expired");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("voids unfunded pending_fund cancel without a refund tx", async () => {
    const { db, sql, posterId, fullName, rail } = await fixture();
    try {
      const created = await postBounty(db, posterId, fullName, 26, "8");
      const voided = await refundEscrow(
        created.id,
        { actorUserId: posterId, reason: "cancel" },
        { db, rail },
      );
      assert.equal(voided.bountyStatus, "cancelled");
      assert.equal(voided.refundTxHash, null);
      const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(escrow?.status, "failed");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("settles an eligible claim and marks it paid", async () => {
    const { db, sql, posterId, hunterId, fullName, rail } = await fixture();
    try {
      const created = await postBounty(db, posterId, fullName, 27);
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      const [claim] = await db
        .insert(claims)
        .values({
          bountyId: created.id,
          hunterUserId: hunterId,
          status: "eligible",
          prNumber: 99,
          payoutAddress: HUNTER_ADDRESS,
        })
        .returning({ id: claims.id });
      const settled = await settleEscrow(
        created.id,
        { actorUserId: posterId, claimId: claim?.id },
        { db, rail },
      );
      assert.equal(settled.bountyStatus, "settled");
      const [paid] = await db.select().from(claims).where(eq(claims.id, claim!.id));
      assert.equal(paid?.status, "paid");
      assert.equal(paid?.payoutUsdc, "98.000000");
      assert.equal(paid?.payoutTxHash, settled.payoutTxHash);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
