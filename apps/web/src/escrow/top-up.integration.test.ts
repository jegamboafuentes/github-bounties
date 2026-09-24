import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createBountyFromIssueUrl } from "../bounties/create";
import { fundBounty, topUpBounty } from "../bounties/fund";
import { claimPoolPayout, claimPayout } from "../claims/payout";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import {
  allocationLedger,
  bounties,
  bountyContributions,
  claims,
  escrows,
  feeLedger,
  poolParticipants,
  repos,
  users,
} from "../db/schema";
import { EscrowError } from "./errors";
import { probeCdpEnv } from "./env";
import { usdcToAtomic, splitPostFeePool } from "../lib/money";
import { createMockRail } from "./rail";
import { refundEscrow } from "./service";
import { listBountyContributions } from "./top-up";
import { handleX402Fund } from "./x402-http";

loadDotenvFiles();

const POSTER_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HUNTER_ADDRESS = "0x1111111111111111111111111111111111111111";
const ALICE_ADDRESS = "0x2222222222222222222222222222222222222222";
const BOB_ADDRESS = "0x3333333333333333333333333333333333333333";

async function fixture(face = "100") {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const otherId = randomUUID();
  const hunterId = randomUUID();
  const aliceId = randomUUID();
  const bobId = randomUUID();
  const fullName = `test/topup-${suffix}`;
  const githubRepoId = BigInt(82_000_000 + Number.parseInt(suffix.slice(0, 6), 16));

  await db.insert(users).values([
    {
      id: posterId,
      googleSub: `poster-topup-${suffix}`,
      email: `poster-topup-${suffix}@example.com`,
      displayName: "Ada Poster",
      walletAddress: POSTER_ADDRESS,
    },
    {
      id: otherId,
      googleSub: `other-topup-${suffix}`,
      email: `other-topup-${suffix}@example.com`,
      displayName: "Second Funder",
      walletAddress: OTHER_ADDRESS,
    },
    {
      id: hunterId,
      googleSub: `hunter-topup-${suffix}`,
      email: `hunter-topup-${suffix}@example.com`,
      displayName: "Hunter",
    },
    {
      id: aliceId,
      googleSub: `alice-topup-${suffix}`,
      email: `alice-topup-${suffix}@example.com`,
      displayName: "Alice",
    },
    {
      id: bobId,
      googleSub: `bob-topup-${suffix}`,
      email: `bob-topup-${suffix}@example.com`,
      displayName: "Bob",
    },
  ]);
  await db.insert(repos).values({
    id: randomUUID(),
    githubRepoId,
    fullName,
    installationId: BigInt(9003),
    connectedByUserId: posterId,
    isActive: true,
  });

  const created = await createBountyFromIssueUrl(
    {
      posterUserId: posterId,
      issueUrl: `https://github.com/${fullName}/issues/8`,
      amountUsdc: face,
    },
    { db, fetchIssueSnapshot: async () => null },
  );
  const rail = createMockRail(probeCdpEnv({}));
  return { db, sql, posterId, otherId, hunterId, aliceId, bobId, created, rail, suffix };
}

describe("crowdfund top-ups on a funded bounty", () => {
  it("lets a second and third funder increase face, then claim uses that face", async () => {
    const { db, sql, posterId, otherId, hunterId, aliceId, bobId, created, rail, suffix } =
      await fixture("100");
    try {
      await fundBounty(created.id, posterId, db, new Date("2026-09-01T00:00:00.000Z"), { rail });
      const second = await topUpBounty(
        created.id,
        otherId,
        {
          amountUsdc: "20",
          fundTxHash: `0xsecond${suffix}0000000000000000000000000000000000000000000000`,
          funderAddress: OTHER_ADDRESS,
        },
        db,
        new Date("2026-09-01T00:00:01.000Z"),
        { rail },
      );
      assert.equal(second.alreadyApplied, false);
      assert.equal(second.faceUsdc, "120.000000");
      assert.equal(second.status, "funded");

      const third = await topUpBounty(
        created.id,
        posterId,
        {
          amountUsdc: "5",
          fundTxHash: `0xthird${suffix}00000000000000000000000000000000000000000000000`,
          funderAddress: POSTER_ADDRESS,
        },
        db,
        new Date("2026-09-01T00:00:02.000Z"),
        { rail },
      );
      assert.equal(third.faceUsdc, "125.000000");

      const replay = await topUpBounty(
        created.id,
        otherId,
        {
          amountUsdc: "20",
          fundTxHash: `0xsecond${suffix}0000000000000000000000000000000000000000000000`,
        },
        db,
        new Date("2026-09-01T00:00:03.000Z"),
        { rail },
      );
      assert.equal(replay.alreadyApplied, true);
      assert.equal(replay.faceUsdc, "125.000000");

      const [bounty] = await db.select().from(bounties).where(eq(bounties.id, created.id));
      const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(bounty?.status, "funded");
      assert.equal(bounty?.amountUsdc, "125.000000");
      assert.equal(escrow?.status, "funded");
      assert.equal(escrow?.amountUsdc, "125.000000");
      assert.equal(escrow?.funderAddress, POSTER_ADDRESS);

      const funders = await listBountyContributions(created.id, db);
      assert.deepEqual(
        funders.map((row) => ({ name: row.displayName, amount: row.amountUsdc })),
        [
          { name: "Ada Poster", amount: "100.000000" },
          { name: "Second Funder", amount: "20.000000" },
          { name: "Ada Poster", amount: "5.000000" },
        ],
      );
      const attributed = funders.reduce((sum, row) => sum + usdcToAtomic(row.amountUsdc), 0n);
      assert.equal(attributed, usdcToAtomic("125.000000"));

      const split = splitPostFeePool("125.000000", 2);
      assert.equal(split.feeBps, 200);
      const [claim] = await db
        .insert(claims)
        .values({
          bountyId: created.id,
          hunterUserId: hunterId,
          status: "eligible",
          prNumber: 80,
          prAuthorLogin: "winner",
        })
        .returning();
      const frozenAt = new Date("2026-09-17T12:00:00.000Z");
      await db.insert(poolParticipants).values([
        {
          bountyId: created.id,
          githubId: 3_000_001n,
          githubLogin: "winner",
          userId: hunterId,
          role: "winner",
          frozenAt,
          shareUsdc: split.winnerUsdc,
        },
        {
          bountyId: created.id,
          githubId: 3_000_002n,
          githubLogin: "alice",
          userId: aliceId,
          role: "pool",
          frozenAt,
          shareUsdc: split.eachUsdc ?? "0",
        },
        {
          bountyId: created.id,
          githubId: 3_000_003n,
          githubLogin: "bob",
          userId: bobId,
          role: "pool",
          frozenAt,
          shareUsdc: split.eachUsdc ?? "0",
        },
      ]);

      await assert.rejects(
        () =>
          topUpBounty(
            created.id,
            otherId,
            { amountUsdc: "1", fundTxHash: `0xlate${suffix}` },
            db,
            new Date("2026-09-01T00:00:04.000Z"),
            { rail },
          ),
        (err: unknown) => err instanceof EscrowError && err.code === "not_fundable",
      );
      const [still] = await db.select().from(bounties).where(eq(bounties.id, created.id));
      assert.equal(still?.amountUsdc, "125.000000");

      const winner = await claimPayout(
        created.id,
        hunterId,
        { payoutAddress: HUNTER_ADDRESS, claimId: claim?.id },
        { db, rail },
      );
      assert.equal(winner.bountyStatus, "settled_partial");
      assert.equal(winner.faceUsdc, split.faceUsdc);
      assert.equal(winner.feeUsdc, split.feeUsdc);
      assert.equal(winner.winnerUsdc, split.winnerUsdc);
      assert.equal(winner.feeBps, 200);

      const alice = await claimPoolPayout(
        created.id,
        aliceId,
        { payoutAddress: ALICE_ADDRESS },
        { db, rail },
      );
      assert.equal(alice.poolShareUsdc, split.eachUsdc);
      assert.equal(alice.bountyStatus, "settled_partial");

      const bob = await claimPoolPayout(
        created.id,
        bobId,
        { payoutAddress: BOB_ADDRESS },
        { db, rail },
      );
      assert.equal(bob.poolShareUsdc, split.eachUsdc);
      assert.equal(bob.bountyStatus, "settled");

      const legs = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, created.id));
      const winnerLeg = legs.find((row) => row.kind === "WINNER_PAYOUT");
      const feeLeg = legs.find((row) => row.kind === "FEE_OUT");
      const poolLegs = legs.filter((row) => row.kind === "POOL_PAYOUT");
      assert.equal(winnerLeg?.amountUsdc, split.winnerUsdc);
      assert.equal(feeLeg?.amountUsdc, split.feeUsdc);
      assert.equal(poolLegs.length, 2);
      assert.ok(poolLegs.every((row) => row.amountUsdc === split.eachUsdc && row.txHash));

      const [fee] = await db.select().from(feeLedger).where(eq(feeLedger.bountyId, created.id));
      assert.equal(fee?.faceUsdc, "125.000000");
      assert.equal(fee?.feeUsdc, split.feeUsdc);
      assert.equal(fee?.feeBps, 200);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("refunds each funder their contribution and keeps a single-funder refund on the old rail", async () => {
    const { db, sql, posterId, otherId, created, rail, suffix } = await fixture("10");
    const transfers: { to: string; amount: bigint; kind: string }[] = [];
    const orig = rail.transferUsdc.bind(rail);
    rail.transferUsdc = async (input) => {
      transfers.push({ to: input.to, amount: input.amountAtomic, kind: input.kind });
      return orig(input);
    };
    try {
      await fundBounty(created.id, posterId, db, new Date("2026-09-02T00:00:00.000Z"), { rail });
      await topUpBounty(
        created.id,
        otherId,
        {
          amountUsdc: "4",
          fundTxHash: `0xrefund${suffix}000000000000000000000000000000000000000000000`,
          funderAddress: OTHER_ADDRESS,
        },
        db,
        new Date("2026-09-02T00:00:01.000Z"),
        { rail },
      );

      const cancelled = await refundEscrow(
        created.id,
        { actorUserId: posterId, reason: "cancel" },
        { db, rail },
      );
      assert.equal(cancelled.bountyStatus, "cancelled");
      assert.equal(cancelled.escrowStatus, "refunded");
      assert.equal(transfers.length, 2);
      assert.deepEqual(
        transfers.map((row) => ({ to: row.to, amount: row.amount.toString(), kind: row.kind })),
        [
          { to: POSTER_ADDRESS, amount: usdcToAtomic("10").toString(), kind: "REFUND_OUT" },
          { to: OTHER_ADDRESS, amount: usdcToAtomic("4").toString(), kind: "REFUND_OUT" },
        ],
      );
      const rows = await db
        .select()
        .from(bountyContributions)
        .where(eq(bountyContributions.bountyId, created.id));
      assert.equal(rows.length, 2);
      assert.ok(rows.every((row) => row.refundTxHash));
      const [fee] = await db.select().from(feeLedger).where(eq(feeLedger.bountyId, created.id));
      assert.equal(fee, undefined);

      const solo = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/test/topup-${suffix}/issues/9`,
          amountUsdc: "8",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      transfers.length = 0;
      await fundBounty(solo.id, posterId, db, new Date("2026-09-02T00:00:02.000Z"), { rail });
      const soloRefund = await refundEscrow(
        solo.id,
        { actorUserId: posterId, reason: "cancel" },
        { db, rail },
      );
      assert.equal(soloRefund.bountyStatus, "cancelled");
      assert.equal(transfers.length, 1);
      assert.equal(transfers[0]?.to, POSTER_ADDRESS);
      assert.equal(transfers[0]?.amount, usdcToAtomic("8"));
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("prices a funded top-up on the x402 exact rail and leaves a plain funded GET already funded", async () => {
    const { db, sql, posterId, otherId, created, rail } = await fixture("12");
    const cdpLike = createMockRail(probeCdpEnv({}));
    (cdpLike as { mode: "cdp" }).mode = "cdp";
    cdpLike.missingEnv = [];
    try {
      await fundBounty(created.id, posterId, db, new Date("2026-09-03T00:00:00.000Z"), { rail });

      const open = await handleX402Fund(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/x402`),
        created.id,
        { db, rail: cdpLike, actorUserId: otherId },
      );
      assert.equal(open.status, 200);
      assert.equal((open.body as { alreadyFunded?: boolean }).alreadyFunded, true);

      const unsigned = await handleX402Fund(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/x402?topUpUsdc=3`),
        created.id,
        { db, rail: cdpLike },
      );
      assert.equal(unsigned.status, 401);

      const challenge = await handleX402Fund(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/x402?topUpUsdc=3`),
        created.id,
        { db, rail: cdpLike, actorUserId: otherId },
      );
      assert.equal(challenge.status, 402);
      const accepts = (challenge.body as { accepts?: { amount?: string; scheme?: string }[] }).accepts;
      assert.equal(accepts?.[0]?.scheme, "exact");
      assert.equal(accepts?.[0]?.amount, "3000000");

      const paid = await handleX402Fund(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/x402?topUpUsdc=3`, {
          method: "POST",
          headers: { "PAYMENT-SIGNATURE": "sig" },
        }),
        created.id,
        {
          db,
          rail: cdpLike,
          actorUserId: otherId,
          liveSeller: async () => ({
            kind: "settled",
            settled: {
              status: 200,
              headers: {},
              txHash: "0xtopupx402000000000000000000000000000000000000000000000000001",
              payer: OTHER_ADDRESS,
            },
          }),
        },
      );
      assert.equal(paid.status, 200);
      const body = paid.body as { topUpApplied?: boolean; faceUsdc?: string; fundTxHash?: string };
      assert.equal(body.topUpApplied, true);
      assert.equal(body.faceUsdc, "15.000000");
      assert.equal(body.fundTxHash, "0xtopupx402000000000000000000000000000000000000000000000000001");

      const [bounty] = await db.select().from(bounties).where(eq(bounties.id, created.id));
      const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(bounty?.amountUsdc, "15.000000");
      assert.equal(escrow?.amountUsdc, "15.000000");
      assert.equal(bounty?.status, "funded");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
