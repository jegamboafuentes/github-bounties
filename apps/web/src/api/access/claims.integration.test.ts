import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createBountyFromIssueUrl } from "../../bounties/create";
import { fundBounty } from "../../bounties/fund";
import { createDb } from "../../db/client";
import { loadDotenvFiles } from "../../db/load-dotenv";
import {
  allocationLedger,
  bounties,
  claims,
  escrows,
  githubLinks,
  poolParticipants,
  repos,
  users,
} from "../../db/schema";
import { probeCdpEnv } from "../../escrow/env";
import { createMockRail, MOCK_FEE_ADDRESS } from "../../escrow/rail";
import { authenticateBearer, createApiKey, handleClaim, handleMyClaims, handleRefund, type ApiPrincipal } from "./handlers";
import { createAccessDeps } from "./store";

loadDotenvFiles();

const POSTER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HUNTER = "0x1111111111111111111111111111111111111111";
const ALICE = "0x2222222222222222222222222222222222222222";
const BOB = "0x3333333333333333333333333333333333333333";
const RECORDED = "0x4444444444444444444444444444444444444444";
const ATTACKER = "0x9999999999999999999999999999999999999999";

const ENV = {
  CDP_NETWORK: "base-sepolia",
  API_KEY_HMAC_SECRET: "test-hmac-secret-value",
  API_MONEY_ENABLED: "1",
};

async function fixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const hunterId = randomUUID();
  const aliceId = randomUUID();
  const bobId = randomUUID();
  const malloryId = randomUUID();
  const fullName = `test/api-claim-${suffix}`;
  const githubRepoId = BigInt(84_000_000 + Number.parseInt(suffix.slice(0, 6), 16));
  await db.insert(users).values([
    { id: posterId, googleSub: `poster-${suffix}`, email: `poster-${suffix}@example.com`, displayName: "Ada", walletAddress: POSTER },
    { id: hunterId, googleSub: `hunter-${suffix}`, email: `hunter-${suffix}@example.com`, displayName: "Hunter", walletAddress: HUNTER },
    { id: aliceId, googleSub: `alice-${suffix}`, email: `alice-${suffix}@example.com`, displayName: "Alice", walletAddress: ALICE },
    { id: bobId, googleSub: `bob-${suffix}`, email: `bob-${suffix}@example.com`, displayName: "Bob", walletAddress: BOB },
    { id: malloryId, googleSub: `mallory-${suffix}`, email: `mallory-${suffix}@example.com`, displayName: "Mallory", walletAddress: ATTACKER },
  ]);
  await db.insert(githubLinks).values([
    { userId: posterId, githubId: BigInt(`0x1${suffix}`), githubLogin: "ada" },
    { userId: hunterId, githubId: BigInt(`0x2${suffix}`), githubLogin: "octocat" },
    { userId: aliceId, githubId: BigInt(`0x3${suffix}`), githubLogin: "alice" },
    { userId: bobId, githubId: BigInt(`0x4${suffix}`), githubLogin: "bob" },
    { userId: malloryId, githubId: BigInt(`0x5${suffix}`), githubLogin: "mallory" },
  ]);
  await db.insert(repos).values({
    id: randomUUID(),
    githubRepoId,
    fullName,
    installationId: BigInt(9104),
    connectedByUserId: posterId,
    isActive: true,
  });
  const rail = createMockRail(probeCdpEnv({}));
  const transfers: string[] = [];
  const orig = rail.transferUsdc.bind(rail);
  rail.transferUsdc = async (input) => {
    transfers.push(input.to);
    return orig(input);
  };
  const deps = createAccessDeps(db, ENV, () => new Date(), rail);
  return { db, sql, suffix, posterId, hunterId, aliceId, bobId, malloryId, fullName, rail, transfers, deps };
}

async function keyFor(deps: ReturnType<typeof createAccessDeps>, userId: string): Promise<ApiPrincipal> {
  const created = await createApiKey({ userId, name: `claim-${userId.slice(0, 8)}`, scopes: ["read", "money"] }, deps);
  const principal = await authenticateBearer(`Bearer ${created.token}`, "203.0.113.10", deps);
  assert.ok(principal);
  return principal;
}

describe("V4-3 API claims and refund (mock rail)", () => {
  it("pays the saved wallet, replays without a second leg, and limits a pool claim to that member", async () => {
    const fx = await fixture();
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: fx.posterId,
          issueUrl: `https://github.com/${fx.fullName}/issues/41`,
          amountUsdc: "100",
        },
        { db: fx.db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(created.id, fx.posterId, fx.db, new Date(), { rail: fx.rail });
      const [claim] = await fx.db
        .insert(claims)
        .values({
          bountyId: created.id,
          hunterUserId: fx.hunterId,
          status: "eligible",
          prNumber: 141,
          prAuthorLogin: "OctoCat",
        })
        .returning();
      const frozenAt = new Date("2026-09-17T12:00:00.000Z");
      await fx.db.insert(poolParticipants).values([
        {
          bountyId: created.id,
          githubId: BigInt(`0x2${fx.suffix}`),
          githubLogin: "octocat",
          userId: fx.hunterId,
          role: "winner",
          frozenAt,
          shareUsdc: "83.300000",
        },
        {
          bountyId: created.id,
          githubId: BigInt(`0x3${fx.suffix}`),
          githubLogin: "alice",
          userId: fx.aliceId,
          role: "pool",
          frozenAt,
          shareUsdc: "7.350000",
        },
        {
          bountyId: created.id,
          githubId: BigInt(`0x4${fx.suffix}`),
          githubLogin: "bob",
          userId: fx.bobId,
          role: "pool",
          frozenAt,
          shareUsdc: "7.350000",
        },
      ]);

      const hunter = await keyFor(fx.deps, fx.hunterId);
      const alice = await keyFor(fx.deps, fx.aliceId);
      const mallory = await keyFor(fx.deps, fx.malloryId);

      await assert.rejects(
        () => handleClaim(hunter, created.id, { kind: "winner", payoutAddress: ATTACKER }, "bad-addr", fx.deps),
        (err: unknown) => err instanceof Error && "code" in err && err.code === "validation_failed",
      );
      assert.equal(fx.transfers.length, 0);

      const first = await handleClaim(hunter, created.id, { kind: "winner" }, "winner-1", fx.deps);
      const body = first.body as { destination?: string; txHash?: string; status?: string };
      assert.equal(first.status, 200);
      assert.equal(body.destination?.toLowerCase(), HUNTER);
      assert.equal(body.status, "paid");
      assert.ok(body.txHash);
      assert.equal(fx.transfers.filter((to) => to.toLowerCase() === HUNTER).length, 1);
      assert.equal(fx.transfers.filter((to) => to.toLowerCase() === MOCK_FEE_ADDRESS.toLowerCase()).length, 1);
      assert.equal(fx.transfers.includes(ALICE), false);
      assert.equal(fx.transfers.includes(BOB), false);
      assert.equal(fx.transfers.includes(ATTACKER), false);

      const paidLegs = fx.transfers.length;
      const replay = await handleClaim(hunter, created.id, { kind: "winner" }, "winner-1", fx.deps);
      assert.deepEqual(replay.body, first.body);
      assert.equal(fx.transfers.length, paidLegs);
      const winnerLedger = (
        await fx.db.select().from(allocationLedger).where(eq(allocationLedger.bountyId, created.id))
      ).filter((row) => row.kind === "WINNER_PAYOUT" && row.txHash);
      assert.equal(winnerLedger.length, 1);

      const [paidClaim] = await fx.db.select().from(claims).where(eq(claims.id, claim!.id));
      assert.equal(paidClaim?.payoutAddress?.toLowerCase(), HUNTER);
      const [hunterUser] = await fx.db.select().from(users).where(eq(users.id, fx.hunterId));
      assert.equal(hunterUser?.walletAddress, HUNTER);

      await assert.rejects(
        () => handleClaim(mallory, created.id, { kind: "winner" }, "mallory", fx.deps),
        (err: unknown) => err instanceof Error && "code" in err && err.code === "not_winner",
      );
      assert.equal(fx.transfers.length, paidLegs);

      const pool = await handleClaim(alice, created.id, { kind: "pool" }, "pool-alice", fx.deps);
      assert.equal((pool.body as { destination?: string }).destination?.toLowerCase(), ALICE);
      assert.equal(fx.transfers.filter((to) => to.toLowerCase() === ALICE).length, 1);
      assert.equal(fx.transfers.includes(BOB), false);
      const [bobRow] = await fx.db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.userId, fx.bobId));
      assert.equal(bobRow?.payoutTxHash, null);
      const [aliceRow] = await fx.db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.userId, fx.aliceId));
      assert.equal(aliceRow?.payoutTxHash, (pool.body as { txHash?: string }).txHash);

      const mine = await handleMyClaims(alice, fx.deps);
      const legs = (mine.body as { claims: { kind: string; txHash: string | null; bountyId: string; destination: string | null }[] }).claims;
      const poolLeg = legs.find((leg) => leg.bountyId === created.id && leg.kind === "pool" && leg.txHash);
      assert.ok(poolLeg);
      assert.equal(poolLeg.destination?.toLowerCase(), ALICE);
      assert.equal(legs.some((leg) => leg.kind === "winner"), false);
      const [bounty] = await fx.db.select().from(bounties).where(eq(bounties.id, created.id));
      assert.equal(bounty?.status, "settled_partial");
    } finally {
      await fx.sql.end({ timeout: 5 });
    }
  });

  it("refunds a funded bounty only to the recorded payer", async () => {
    const fx = await fixture();
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: fx.posterId,
          issueUrl: `https://github.com/${fx.fullName}/issues/42`,
          amountUsdc: "9",
        },
        { db: fx.db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(created.id, fx.posterId, fx.db, new Date(), { rail: fx.rail });
      await fx.db.update(escrows).set({ funderAddress: RECORDED }).where(eq(escrows.bountyId, created.id));
      const poster = await keyFor(fx.deps, fx.posterId);

      await assert.rejects(
        () => handleRefund(poster, created.id, { destination: ATTACKER }, "refund-bad", fx.deps),
        (err: unknown) => err instanceof Error && "code" in err && err.code === "validation_failed",
      );
      assert.equal(fx.transfers.length, 0);

      const refunded = await handleRefund(poster, created.id, {}, "refund-1", fx.deps);
      assert.equal(refunded.status, 200);
      assert.equal((refunded.body as { destination?: string }).destination?.toLowerCase(), RECORDED);
      assert.deepEqual(fx.transfers.map((to) => to.toLowerCase()), [RECORDED]);
      const again = await handleRefund(poster, created.id, {}, "refund-1", fx.deps);
      assert.deepEqual(again.body, refunded.body);
      assert.equal(fx.transfers.length, 1);
      const [row] = await fx.db.select().from(bounties).where(eq(bounties.id, created.id));
      assert.equal(row?.status, "cancelled");
    } finally {
      await fx.sql.end({ timeout: 5 });
    }
  });
});
