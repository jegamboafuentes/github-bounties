import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, claims, escrows, feeLedger, allocationLedger, poolParticipants, repos, users } from "../db/schema";
import { createBountyFromIssueUrl } from "../bounties/create";
import { fundBounty } from "../bounties/fund";
import { EscrowError } from "./errors";
import { VOIDED_UNFUNDED_CODE } from "./fail";
import { getEscrowSnapshot } from "./read";
import { createMockRail, MOCK_FEE_ADDRESS } from "./rail";
import { expireUnmergedBounties, lockEscrowFunds, refundEscrow, settleEscrow } from "./service";
import { probeCdpEnv } from "./env";

loadDotenvFiles();

const HUNTER_ADDRESS = "0x1111111111111111111111111111111111111111";

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
      walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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

/** Settle now requires the merge-flow claim. Caller hunter fields are ignored. */
async function markEligibleClaim(
  db: ReturnType<typeof createDb>["db"],
  bountyId: string,
  hunterId: string,
) {
  const [existing] = await db
    .select({ id: claims.id })
    .from(claims)
    .where(eq(claims.bountyId, bountyId))
    .limit(1);
  if (existing) return;
  await db.insert(claims).values({
    bountyId,
    hunterUserId: hunterId,
    status: "eligible",
    prNumber: 9000,
    payoutAddress: HUNTER_ADDRESS,
  });
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
      await markEligibleClaim(db, created.id, hunterId);

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
      await markEligibleClaim(db, created.id, hunterId);
      const partial = await settleEscrow(
        created.id,
        { actorUserId: posterId, hunterUserId: hunterId, hunterPayoutAddress: HUNTER_ADDRESS },
        { db, rail: failFeeOnce },
      );
      assert.equal(partial.bountyStatus, "settled_partial");
      assert.ok(partial.payoutTxHash);
      assert.equal(partial.feeTxHash, null);

      const [afterFeeFail] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(afterFeeFail?.failCode, "rail_failed");
      assert.match(afterFeeFail?.failReason ?? "", /simulated fee drop/);
      const feeSnap = await getEscrowSnapshot(created.id, db);
      assert.match(feeSnap?.failLabel ?? "", /rail_failed/);

      const retried = await settleEscrow(
        created.id,
        { actorUserId: posterId, hunterUserId: hunterId, hunterPayoutAddress: HUNTER_ADDRESS },
        { db, rail: failFeeOnce },
      );
      assert.equal(retried.bountyStatus, "settled");
      assert.equal(retried.payoutTxHash, partial.payoutTxHash);
      assert.ok(retried.feeTxHash?.startsWith("mock:"));
      const [afterFeeOk] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(afterFeeOk?.failCode, null);
      assert.equal(afterFeeOk?.failReason, null);
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
      assert.equal(escrow?.failCode, VOIDED_UNFUNDED_CODE);
      assert.ok(escrow?.failReason);
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

  it("stores and returns fail_code + fail_reason on a failed Lock (inbound_unconfirmed)", async () => {
    const { db, sql, posterId, fullName } = await fixture();
    const rail = createMockRail(probeCdpEnv({}));
    rail.lockFace = async () => {
      throw new EscrowError(
        "inbound_unconfirmed",
        "Send face USDC to gb-escrow (0xabc) on base-sepolia, then retry fund with the on-chain tx hash.",
        { details: { escrowAddress: "0xabc", network: "base-sepolia" } },
      );
    };
    try {
      const created = await postBounty(db, posterId, fullName, 28, "12");
      await assert.rejects(
        () => fundBounty(created.id, posterId, db, new Date(), { rail }),
        (err: unknown) =>
          err instanceof EscrowError &&
          err.code === "inbound_unconfirmed" &&
          /Send face USDC/.test(err.message),
      );

      const [row] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(row?.status, "pending");
      assert.equal(row?.failCode, "inbound_unconfirmed");
      assert.match(row?.failReason ?? "", /Send face USDC/);

      const snap = await getEscrowSnapshot(created.id, db);
      assert.equal(snap?.failCode, "inbound_unconfirmed");
      assert.match(snap?.failReason ?? "", /Send face USDC/);
      assert.match(snap?.failLabel ?? "", /inbound_unconfirmed/);

      await assert.rejects(
        () => lockEscrowFunds(created.id, posterId, { db, rail }),
        (err: unknown) => err instanceof EscrowError && err.code === "inbound_unconfirmed",
      );

      const voided = await refundEscrow(
        created.id,
        { actorUserId: posterId, reason: "cancel" },
        { db, rail },
      );
      assert.equal(voided.bountyStatus, "cancelled");
      const [afterCancel] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(afterCancel?.status, "failed");
      assert.equal(afterCancel?.failCode, "inbound_unconfirmed");
      assert.match(afterCancel?.failReason ?? "", /Send face USDC/);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("persists fail_code when hunter transfer throws after entering settling, then retries", async () => {
    const { db, sql, posterId, hunterId, fullName } = await fixture();
    const failHunterOnce = createMockRail(probeCdpEnv({}));
    let hunterCalls = 0;
    const orig = failHunterOnce.transferUsdc.bind(failHunterOnce);
    failHunterOnce.transferUsdc = async (input) => {
      if (input.purpose === "hunter") {
        hunterCalls += 1;
        if (hunterCalls === 1) {
          throw new EscrowError(
            "rail_failed",
            "Insufficient balance to execute the transaction",
          );
        }
      }
      return orig(input);
    };
    try {
      const created = await postBounty(db, posterId, fullName, 30, "50");
      await fundBounty(created.id, posterId, db, new Date(), { rail: failHunterOnce });
      await markEligibleClaim(db, created.id, hunterId);

      await assert.rejects(
        () =>
          settleEscrow(
            created.id,
            { actorUserId: posterId, hunterUserId: hunterId, hunterPayoutAddress: HUNTER_ADDRESS },
            { db, rail: failHunterOnce },
          ),
        (err: unknown) =>
          err instanceof EscrowError &&
          err.code === "rail_failed" &&
          /Insufficient balance/.test(err.message),
      );

      const [row] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(row?.status, "settling");
      assert.equal(row?.payoutTxHash, null);
      assert.equal(row?.feeTxHash, null);
      assert.equal(row?.failCode, "rail_failed");
      assert.match(row?.failReason ?? "", /Insufficient balance/);

      const [bounty] = await db
        .select({ status: bounties.status })
        .from(bounties)
        .where(eq(bounties.id, created.id));
      assert.equal(bounty?.status, "settling");

      const snap = await getEscrowSnapshot(created.id, db);
      assert.equal(snap?.failCode, "rail_failed");
      assert.match(snap?.failLabel ?? "", /rail_failed/);

      const retried = await settleEscrow(
        created.id,
        { actorUserId: posterId, hunterUserId: hunterId, hunterPayoutAddress: HUNTER_ADDRESS },
        { db, rail: failHunterOnce },
      );
      assert.equal(retried.bountyStatus, "settled");
      assert.equal(retried.escrowStatus, "settled");
      assert.ok(retried.payoutTxHash?.startsWith("mock:"));
      assert.ok(retried.feeTxHash?.startsWith("mock:"));

      const [after] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(after?.status, "settled");
      assert.equal(after?.failCode, null);
      assert.equal(after?.failReason, null);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("clears fail_code after a successful Lock retry", async () => {
    const { db, sql, posterId, fullName } = await fixture();
    const failThenOk = createMockRail(probeCdpEnv({}));
    let calls = 0;
    const orig = failThenOk.lockFace.bind(failThenOk);
    failThenOk.lockFace = async (input) => {
      calls += 1;
      if (calls === 1) {
        throw new EscrowError("rail_failed", "simulated CDP transfer() missing");
      }
      return orig(input);
    };
    try {
      const created = await postBounty(db, posterId, fullName, 29, "9");
      await assert.rejects(
        () => fundBounty(created.id, posterId, db, new Date(), { rail: failThenOk }),
        (err: unknown) => err instanceof EscrowError && err.code === "rail_failed",
      );
      const funded = await fundBounty(created.id, posterId, db, new Date(), { rail: failThenOk });
      assert.equal(funded.status, "funded");
      const [row] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(row?.status, "funded");
      assert.equal(row?.failCode, null);
      assert.equal(row?.failReason, null);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});

const ALICE_ADDRESS = "0x2222222222222222222222222222222222222222";
const BOB_ADDRESS = "0x3333333333333333333333333333333333333333";

function githubId(): bigint {
  return BigInt(`0x${randomUUID().replace(/-/g, "").slice(0, 12)}`);
}

async function insertFreeze(
  db: ReturnType<typeof createDb>["db"],
  args: {
    bountyId: string;
    winner: { userId: string; login: string; address: string; shareUsdc: string };
    pool: {
      userId: string | null;
      login: string;
      githubId?: bigint;
      address: string | null;
      shareUsdc: string;
    }[];
    overflow?: number;
  },
) {
  const frozenAt = new Date("2026-09-17T12:00:00.000Z");
  await db.insert(poolParticipants).values({
    bountyId: args.bountyId,
    githubId: githubId(),
    githubLogin: args.winner.login,
    userId: args.winner.userId,
    role: "winner",
    frozenAt,
    shareUsdc: args.winner.shareUsdc,
    payoutAddress: args.winner.address,
  });
  for (const member of args.pool) {
    await db.insert(poolParticipants).values({
      bountyId: args.bountyId,
      githubId: member.githubId ?? githubId(),
      githubLogin: member.login,
      userId: member.userId,
      role: "pool",
      frozenAt,
      shareUsdc: member.shareUsdc,
      payoutAddress: member.address,
      skipReason: member.userId ? null : "hunter_not_linked",
    });
  }
  for (let i = 0; i < (args.overflow ?? 0); i += 1) {
    await db.insert(poolParticipants).values({
      bountyId: args.bountyId,
      githubId: githubId(),
      githubLogin: `overflow${i}`,
      role: "overflow",
      frozenAt,
      shareUsdc: "0",
      skipReason: "overflow",
    });
  }
}

describe("V2-3 escrow multi-payee settle (mock rail)", () => {
  it("empty-pool regression: |E|=0 freeze pays V1 post_fee; no POOL_PAYOUT rows", async () => {
    const { db, sql, posterId, hunterId, fullName, rail } = await fixture();
    try {
      const created = await postBounty(db, posterId, fullName, 61);
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      await markEligibleClaim(db, created.id, hunterId);
      await insertFreeze(db, {
        bountyId: created.id,
        winner: {
          userId: hunterId,
          login: "winner",
          address: HUNTER_ADDRESS,
          shareUsdc: "98.000000",
        },
        pool: [],
      });

      const settled = await settleEscrow(
        created.id,
        {
          actorUserId: posterId,
          hunterUserId: hunterId,
          hunterPayoutAddress: HUNTER_ADDRESS,
        },
        { db, rail },
      );
      assert.equal(settled.bountyStatus, "settled");
      assert.equal(settled.hunterUsdc, "98.000000");
      assert.equal(settled.winnerUsdc, "98.000000");
      assert.equal(settled.feeUsdc, "2.000000");
      assert.equal(settled.poolTotalUsdc, "0.000000");
      assert.equal(settled.poolPaidCount, 0);
      assert.ok(settled.payoutTxHash?.startsWith("mock:"));
      assert.ok(settled.feeTxHash?.startsWith("mock:"));
      assert.ok(settled.missingEnv.includes("CDP_API_KEY_ID"));
      assert.equal(settled.hostedCheckout.enabled, false);

      const legs = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, created.id));
      assert.equal(legs.filter((row) => row.kind === "POOL_PAYOUT").length, 0);
      assert.equal(legs.filter((row) => row.kind === "WINNER_PAYOUT").length, 1);
      assert.equal(legs.filter((row) => row.kind === "FEE_OUT").length, 1);
      assert.equal(legs.find((row) => row.kind === "WINNER_PAYOUT")?.amountUsdc, "98.000000");
      assert.equal(legs.find((row) => row.kind === "FEE_OUT")?.amountUsdc, "2.000000");
      assert.ok(legs.every((row) => row.status === "confirmed"));

      const retry = await settleEscrow(
        created.id,
        {
          actorUserId: posterId,
          hunterUserId: hunterId,
          hunterPayoutAddress: HUNTER_ADDRESS,
        },
        { db, rail },
      );
      assert.equal(retry.payoutTxHash, settled.payoutTxHash);
      assert.equal(retry.feeTxHash, settled.feeTxHash);
      const legsAfter = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, created.id));
      assert.equal(legsAfter.length, legs.length);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("pays gb-fee + winner 83.30 + two pool members 7.35 (not 0.15 × F)", async () => {
    const { db, sql, posterId, hunterId, suffix, fullName, rail } = await fixture();
    const aliceId = randomUUID();
    const bobId = randomUUID();
    await db.insert(users).values([
      {
        id: aliceId,
        googleSub: `alice-${suffix}`,
        email: `alice-${suffix}@example.com`,
        displayName: "Alice",
        walletAddress: ALICE_ADDRESS,
      },
      {
        id: bobId,
        googleSub: `bob-${suffix}`,
        email: `bob-${suffix}@example.com`,
        displayName: "Bob",
        walletAddress: BOB_ADDRESS,
      },
    ]);
    try {
      const created = await postBounty(db, posterId, fullName, 62);
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      await markEligibleClaim(db, created.id, hunterId);
      await insertFreeze(db, {
        bountyId: created.id,
        winner: {
          userId: hunterId,
          login: "winner",
          address: HUNTER_ADDRESS,
          shareUsdc: "83.300000",
        },
        pool: [
          {
            userId: aliceId,
            login: "alice",
            address: ALICE_ADDRESS,
            shareUsdc: "7.350000",
          },
          {
            userId: bobId,
            login: "bob",
            address: BOB_ADDRESS,
            shareUsdc: "7.350000",
          },
        ],
      });

      let transfers = 0;
      const orig = rail.transferUsdc.bind(rail);
      rail.transferUsdc = async (input) => {
        transfers += 1;
        return orig(input);
      };

      const settled = await settleEscrow(
        created.id,
        {
          actorUserId: posterId,
          hunterUserId: hunterId,
          hunterPayoutAddress: HUNTER_ADDRESS,
          scope: "all",
        },
        { db, rail },
      );
      assert.equal(settled.bountyStatus, "settled");
      assert.equal(settled.winnerUsdc, "83.300000");
      assert.equal(settled.hunterUsdc, "83.300000");
      assert.equal(settled.feeUsdc, "2.000000");
      assert.equal(settled.poolTotalUsdc, "14.700000");
      assert.equal(settled.poolPaidCount, 2);
      assert.equal(transfers, 4);

      const legs = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, created.id));
      assert.equal(legs.filter((row) => row.kind === "FEE_OUT").length, 1);
      assert.equal(legs.filter((row) => row.kind === "WINNER_PAYOUT").length, 1);
      assert.equal(legs.filter((row) => row.kind === "POOL_PAYOUT").length, 2);
      assert.ok(legs.every((row) => row.status === "confirmed" && row.txHash));
      const keys = new Set(legs.map((row) => row.idempotencyKey));
      assert.equal(keys.size, 4);

      const poolRows = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, created.id));
      const alice = poolRows.find((row) => row.githubLogin === "alice");
      const bob = poolRows.find((row) => row.githubLogin === "bob");
      assert.equal(alice?.payoutTxHash, legs.find((row) => row.participantId === alice?.id)?.txHash);
      assert.equal(bob?.payoutTxHash, legs.find((row) => row.participantId === bob?.id)?.txHash);
      assert.notEqual(alice?.payoutTxHash, settled.payoutTxHash);

      const [bounty] = await db.select().from(bounties).where(eq(bounties.id, created.id));
      assert.equal(bounty?.participationPoolUsdc, "14.700000");

      const beforeRetry = transfers;
      const retry = await settleEscrow(
        created.id,
        {
          actorUserId: posterId,
          hunterUserId: hunterId,
          hunterPayoutAddress: HUNTER_ADDRESS,
          scope: "all",
        },
        { db, rail },
      );
      assert.equal(retry.payoutTxHash, settled.payoutTxHash);
      assert.equal(retry.feeTxHash, settled.feeTxHash);
      assert.equal(transfers, beforeRetry);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("SettledPartial retries remaining pool/fee legs only; never reverses a confirmed hash", async () => {
    const { db, sql, posterId, hunterId, suffix, fullName } = await fixture();
    const aliceId = randomUUID();
    const bobId = randomUUID();
    await db.insert(users).values([
      {
        id: aliceId,
        googleSub: `alice-${suffix}`,
        email: `alice-${suffix}@example.com`,
        displayName: "Alice",
        walletAddress: ALICE_ADDRESS,
      },
      {
        id: bobId,
        googleSub: `bob-${suffix}`,
        email: `bob-${suffix}@example.com`,
        displayName: "Bob",
        walletAddress: BOB_ADDRESS,
      },
    ]);
    const rail = createMockRail(probeCdpEnv({}));
    let poolCalls = 0;
    const orig = rail.transferUsdc.bind(rail);
    rail.transferUsdc = async (input) => {
      if (input.purpose === "pool") {
        poolCalls += 1;
        if (poolCalls === 1) {
          throw new Error("simulated pool drop");
        }
      }
      return orig(input);
    };
    try {
      const created = await postBounty(db, posterId, fullName, 63);
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      await markEligibleClaim(db, created.id, hunterId);
      await insertFreeze(db, {
        bountyId: created.id,
        winner: {
          userId: hunterId,
          login: "winner",
          address: HUNTER_ADDRESS,
          shareUsdc: "83.300000",
        },
        pool: [
          { userId: aliceId, login: "alice", address: ALICE_ADDRESS, shareUsdc: "7.350000" },
          { userId: bobId, login: "bob", address: BOB_ADDRESS, shareUsdc: "7.350000" },
        ],
      });

      const partial = await settleEscrow(
        created.id,
        {
          actorUserId: posterId,
          hunterUserId: hunterId,
          hunterPayoutAddress: HUNTER_ADDRESS,
          scope: "all",
        },
        { db, rail },
      );
      assert.equal(partial.bountyStatus, "settled_partial");
      assert.ok(partial.payoutTxHash);
      assert.ok(partial.feeTxHash);

      const legs = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, created.id));
      const poolLegs = legs.filter((row) => row.kind === "POOL_PAYOUT");
      assert.equal(poolLegs.filter((row) => row.txHash).length, 1);
      assert.equal(poolLegs.filter((row) => !row.txHash).length, 1);
      const winnerHash = legs.find((row) => row.kind === "WINNER_PAYOUT")?.txHash;

      const retried = await settleEscrow(
        created.id,
        {
          actorUserId: posterId,
          hunterUserId: hunterId,
          hunterPayoutAddress: HUNTER_ADDRESS,
          scope: "all",
        },
        { db, rail },
      );
      assert.equal(retried.bountyStatus, "settled");
      assert.equal(retried.payoutTxHash, partial.payoutTxHash);
      assert.equal(retried.feeTxHash, partial.feeTxHash);
      const after = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, created.id));
      assert.equal(after.find((row) => row.kind === "WINNER_PAYOUT")?.txHash, winnerHash);
      assert.equal(after.filter((row) => row.kind === "POOL_PAYOUT" && row.txHash).length, 2);
      assert.ok(after.every((row) => row.status === "confirmed"));
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("keeps an unlinked pool member retryable and does not redistribute", async () => {
    const { db, sql, posterId, hunterId, suffix, fullName, rail } = await fixture();
    const aliceId = randomUUID();
    await db.insert(users).values({
      id: aliceId,
      googleSub: `alice-${suffix}`,
      email: `alice-${suffix}@example.com`,
      displayName: "Alice",
      walletAddress: ALICE_ADDRESS,
    });
    try {
      const created = await postBounty(db, posterId, fullName, 64);
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      await markEligibleClaim(db, created.id, hunterId);
      await insertFreeze(db, {
        bountyId: created.id,
        winner: {
          userId: hunterId,
          login: "winner",
          address: HUNTER_ADDRESS,
          shareUsdc: "83.300000",
        },
        pool: [
          { userId: aliceId, login: "alice", address: ALICE_ADDRESS, shareUsdc: "7.350000" },
          {
            userId: null,
            login: "unlinked",
            address: null,
            shareUsdc: "7.350000",
          },
        ],
      });

      const partial = await settleEscrow(
        created.id,
        {
          actorUserId: posterId,
          hunterUserId: hunterId,
          hunterPayoutAddress: HUNTER_ADDRESS,
          scope: "all",
        },
        { db, rail },
      );
      assert.equal(partial.bountyStatus, "settled_partial");
      assert.equal(partial.winnerUsdc, "83.300000");
      assert.notEqual(partial.winnerUsdc, "98.000000");
      assert.ok(partial.payoutTxHash);
      assert.ok(partial.feeTxHash);

      const legs = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, created.id));
      const unlinked = legs.find(
        (row) => row.kind === "POOL_PAYOUT" && !row.txHash,
      );
      assert.ok(unlinked);
      assert.equal(unlinked?.status, "pending");
      assert.equal(unlinked?.amountUsdc, "7.350000");
      assert.equal(legs.filter((row) => row.kind === "POOL_PAYOUT" && row.txHash).length, 1);

      const snap = await getEscrowSnapshot(created.id, db);
      assert.equal(snap?.status, "settled_partial");
      assert.ok(snap?.reconcile.some((note) => note.includes("pool_confirmed_atomic=7350000")));
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("winner_and_fee ignores unwalletted pool hunters; pool_member later pays that share", async () => {
    const { db, sql, posterId, hunterId, suffix, fullName, rail } = await fixture();
    const aliceId = randomUUID();
    const bobId = randomUUID();
    await db.insert(users).values([
      {
        id: aliceId,
        googleSub: `alice-${suffix}`,
        email: `alice-${suffix}@example.com`,
        displayName: "Alice",
      },
      {
        id: bobId,
        googleSub: `bob-${suffix}`,
        email: `bob-${suffix}@example.com`,
        displayName: "Bob",
        walletAddress: BOB_ADDRESS,
      },
    ]);
    try {
      const created = await postBounty(db, posterId, fullName, 66);
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      await insertFreeze(db, {
        bountyId: created.id,
        winner: {
          userId: hunterId,
          login: "winner",
          address: HUNTER_ADDRESS,
          shareUsdc: "83.300000",
        },
        pool: [
          { userId: aliceId, login: "alice", address: null, shareUsdc: "7.350000" },
          { userId: bobId, login: "bob", address: null, shareUsdc: "7.350000" },
        ],
      });
      await db.insert(claims).values({
        bountyId: created.id,
        hunterUserId: hunterId,
        status: "eligible",
        prNumber: 166,
        prAuthorLogin: "winner",
      });

      let transfers = 0;
      const orig = rail.transferUsdc.bind(rail);
      rail.transferUsdc = async (input) => {
        transfers += 1;
        return orig(input);
      };

      const winner = await settleEscrow(
        created.id,
        {
          actorUserId: hunterId,
          hunterUserId: hunterId,
          hunterPayoutAddress: HUNTER_ADDRESS,
          scope: "winner_and_fee",
        },
        { db, rail },
      );
      assert.equal(winner.bountyStatus, "settled_partial");
      assert.equal(winner.winnerUsdc, "83.300000");
      assert.ok(winner.payoutTxHash);
      assert.ok(winner.feeTxHash);
      assert.equal(transfers, 2);

      const [paidClaim] = await db.select().from(claims).where(eq(claims.bountyId, created.id));
      assert.equal(paidClaim?.status, "paid");
      const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(escrow?.failCode, null);
      const pendingPool = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, created.id));
      assert.equal(pendingPool.filter((row) => row.kind === "POOL_PAYOUT" && row.txHash).length, 0);
      assert.equal(pendingPool.filter((row) => row.kind === "POOL_PAYOUT").length, 2);

      const aliceRow = (await db.select().from(poolParticipants).where(eq(poolParticipants.bountyId, created.id)))
        .find((row) => row.githubLogin === "alice");
      assert.ok(aliceRow);

      const poolPaid = await settleEscrow(
        created.id,
        {
          actorUserId: aliceId,
          participantId: aliceRow.id,
          poolPayoutAddress: ALICE_ADDRESS,
          scope: "pool_member",
        },
        { db, rail },
      );
      assert.equal(poolPaid.bountyStatus, "settled_partial");
      assert.equal(poolPaid.payoutTxHash, winner.payoutTxHash);
      assert.equal(transfers, 3);

      const retryAlice = await settleEscrow(
        created.id,
        {
          actorUserId: aliceId,
          participantId: aliceRow.id,
          poolPayoutAddress: ALICE_ADDRESS,
          scope: "pool_member",
        },
        { db, rail },
      );
      assert.equal(transfers, 3);
      const aliceLeg = (await db.select().from(allocationLedger).where(eq(allocationLedger.bountyId, created.id)))
        .find((row) => row.kind === "POOL_PAYOUT" && row.participantId === aliceRow.id);
      assert.equal(retryAlice.payoutTxHash, winner.payoutTxHash);
      assert.equal(aliceLeg?.txHash?.startsWith("mock:"), true);

      const bobRow = (await db.select().from(poolParticipants).where(eq(poolParticipants.bountyId, created.id)))
        .find((row) => row.githubLogin === "bob");
      assert.ok(bobRow);
      const bobPaid = await settleEscrow(
        created.id,
        {
          actorUserId: bobId,
          participantId: bobRow.id,
          poolPayoutAddress: BOB_ADDRESS,
          scope: "pool_member",
        },
        { db, rail },
      );
      assert.equal(bobPaid.bountyStatus, "settled");
      assert.equal(transfers, 4);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("refunds full F before settle with zero fee/pool/winner and voids pending legs", async () => {
    const { db, sql, posterId, hunterId, fullName, rail } = await fixture();
    try {
      const created = await postBounty(db, posterId, fullName, 65, "40");
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      await insertFreeze(db, {
        bountyId: created.id,
        winner: {
          userId: hunterId,
          login: "winner",
          address: HUNTER_ADDRESS,
          shareUsdc: "33.320000",
        },
        pool: [
          {
            userId: hunterId,
            login: "alice",
            address: ALICE_ADDRESS,
            shareUsdc: "5.880000",
          },
        ],
      });
      await db.insert(allocationLedger).values({
        bountyId: created.id,
        participantId: null,
        kind: "FEE_OUT",
        amountUsdc: "0.800000",
        idempotencyKey: `test-void-fee-${created.id}`,
        status: "pending",
      });

      const cancelled = await refundEscrow(
        created.id,
        { actorUserId: posterId, reason: "cancel" },
        { db, rail },
      );
      assert.equal(cancelled.bountyStatus, "cancelled");
      assert.equal(cancelled.escrowStatus, "refunded");
      assert.ok(cancelled.refundTxHash?.startsWith("mock:"));
      const fees = await db.select().from(feeLedger).where(eq(feeLedger.bountyId, created.id));
      assert.equal(fees.length, 0);
      const legs = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, created.id));
      assert.ok(legs.every((row) => row.txHash == null));
      assert.ok(legs.every((row) => row.status === "failed"));
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});

