import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createBountyFromIssueUrl } from "../bounties/create";
import { fundBounty } from "../bounties/fund";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { allocationLedger, bounties, claims, feeLedger, poolParticipants, repos, users } from "../db/schema";
import { createMockRail } from "../escrow/rail";
import { probeCdpEnv } from "../escrow/env";
import { ClaimError } from "./errors";
import { claimPoolPayout, claimPayout } from "./payout";

loadDotenvFiles();

const HUNTER_ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";

async function fixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const hunterId = randomUUID();
  const otherId = randomUUID();
  const fullName = `test/claim-${suffix}`;
  const githubRepoId = BigInt(81_000_000 + Number.parseInt(suffix.slice(0, 6), 16));

  await db.insert(users).values([
    {
      id: posterId,
      googleSub: `poster-${suffix}`,
      email: `poster-${suffix}@example.com`,
      displayName: "Ada Poster",
    },
    {
      id: hunterId,
      googleSub: `hunter-${suffix}`,
      email: `hunter-${suffix}@example.com`,
      displayName: "Hunter One",
    },
    {
      id: otherId,
      googleSub: `other-${suffix}`,
      email: `other-${suffix}@example.com`,
      displayName: "Other User",
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

  const rail = createMockRail(probeCdpEnv({}));
  return { db, sql, posterId, hunterId, otherId, suffix, fullName, rail };
}

async function eligibleBounty(
  db: ReturnType<typeof createDb>["db"],
  posterId: string,
  hunterId: string,
  fullName: string,
  issue: number,
) {
  const created = await createBountyFromIssueUrl(
    {
      posterUserId: posterId,
      issueUrl: `https://github.com/${fullName}/issues/${issue}`,
      amountUsdc: "100",
    },
    { db, fetchIssueSnapshot: async () => null },
  );
  await fundBounty(created.id, posterId, db);
  const [claim] = await db
    .insert(claims)
    .values({
      bountyId: created.id,
      hunterUserId: hunterId,
      status: "eligible",
      prNumber: issue + 100,
      prAuthorLogin: "octocat",
    })
    .returning();
  return { created, claim };
}

describe("V1-6 hunter claim payout (mock rail)", () => {
  it("lets the eligible hunter claim to a BYO Base address and marks paid", async () => {
    const { db, sql, posterId, hunterId, fullName, rail } = await fixture();
    try {
      const { created, claim } = await eligibleBounty(db, posterId, hunterId, fullName, 31);
      const result = await claimPayout(
        created.id,
        hunterId,
        { payoutAddress: HUNTER_ADDRESS, claimId: claim?.id },
        { db, rail },
      );

      assert.equal(result.bountyStatus, "settled");
      assert.equal(result.claimStatus, "paid");
      assert.equal(result.faceUsdc, "100.000000");
      assert.equal(result.feeUsdc, "2.000000");
      assert.equal(result.hunterUsdc, "98.000000");
      assert.equal(result.feeBps, 200);
      assert.ok(result.payoutTxHash?.startsWith("mock:"));
      assert.ok(result.feeTxHash?.startsWith("mock:"));
      assert.equal(result.hunterAddress, HUNTER_ADDRESS);
      assert.ok(result.missingEnv.includes("CDP_API_KEY_ID"));

      const [bounty] = await db.select().from(bounties).where(eq(bounties.id, created.id));
      assert.equal(bounty?.status, "settled");
      const [paid] = await db.select().from(claims).where(eq(claims.id, claim!.id));
      assert.equal(paid?.status, "paid");
      assert.equal(paid?.payoutAddress, HUNTER_ADDRESS);
      assert.equal(paid?.payoutUsdc, "98.000000");
      assert.equal(paid?.payoutTxHash, result.payoutTxHash);
      const [user] = await db.select().from(users).where(eq(users.id, hunterId));
      assert.equal(user?.walletAddress, HUNTER_ADDRESS);
      const [fee] = await db.select().from(feeLedger).where(eq(feeLedger.bountyId, created.id));
      assert.equal(fee?.feeBps, 200);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("rejects the poster and any non-eligible user", async () => {
    const { db, sql, posterId, hunterId, otherId, fullName, rail } = await fixture();
    try {
      const { created } = await eligibleBounty(db, posterId, hunterId, fullName, 32);

      await assert.rejects(
        () =>
          claimPayout(created.id, posterId, { payoutAddress: HUNTER_ADDRESS }, { db, rail }),
        (err: unknown) => err instanceof ClaimError && err.code === "not_hunter",
      );
      await assert.rejects(
        () => claimPayout(created.id, otherId, { payoutAddress: OTHER_ADDRESS }, { db, rail }),
        (err: unknown) => err instanceof ClaimError && err.code === "not_hunter",
      );

      const noClaim = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/33`,
          amountUsdc: "10",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(noClaim.id, posterId, db);
      await assert.rejects(
        () => claimPayout(noClaim.id, hunterId, { payoutAddress: HUNTER_ADDRESS }, { db, rail }),
        (err: unknown) => err instanceof ClaimError && err.code === "not_eligible",
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("rejects an invalid Base address and stays unpaid", async () => {
    const { db, sql, posterId, hunterId, fullName, rail } = await fixture();
    try {
      const { created, claim } = await eligibleBounty(db, posterId, hunterId, fullName, 34);
      await assert.rejects(
        () =>
          claimPayout(created.id, hunterId, { payoutAddress: "alice.eth" }, { db, rail }),
        (err: unknown) => err instanceof ClaimError && err.code === "invalid_payout_address",
      );
      const [row] = await db.select().from(claims).where(eq(claims.id, claim!.id));
      assert.equal(row?.status, "eligible");
      const [bounty] = await db.select().from(bounties).where(eq(bounties.id, created.id));
      assert.notEqual(bounty?.status, "settled");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("is idempotent for the hunter after paid", async () => {
    const { db, sql, posterId, hunterId, fullName, rail } = await fixture();
    try {
      const { created } = await eligibleBounty(db, posterId, hunterId, fullName, 35);
      const first = await claimPayout(
        created.id,
        hunterId,
        { payoutAddress: HUNTER_ADDRESS },
        { db, rail },
      );
      const second = await claimPayout(
        created.id,
        hunterId,
        { payoutAddress: HUNTER_ADDRESS },
        { db, rail },
      );
      assert.equal(second.payoutTxHash, first.payoutTxHash);
      assert.equal(second.bountyStatus, "settled");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("winner Claim with unwalletted pool hunters succeeds; pool Claim later; double-Claim is safe", async () => {
    const { db, sql, posterId, hunterId, otherId, suffix, fullName, rail } = await fixture();
    const aliceId = otherId;
    const bobId = randomUUID();
    await db.insert(users).values({
      id: bobId,
      googleSub: `bob-${suffix}`,
      email: `bob-${suffix}@example.com`,
      displayName: "Bob",
    });
    try {
      const { created, claim } = await eligibleBounty(db, posterId, hunterId, fullName, 36);
      const frozenAt = new Date("2026-09-17T12:00:00.000Z");
      await db.insert(poolParticipants).values([
        {
          bountyId: created.id,
          githubId: 2_000_001n,
          githubLogin: "winner",
          userId: hunterId,
          role: "winner",
          frozenAt,
          shareUsdc: "83.300000",
        },
        {
          bountyId: created.id,
          githubId: 2_000_002n,
          githubLogin: "alice",
          userId: aliceId,
          role: "pool",
          frozenAt,
          shareUsdc: "7.350000",
        },
        {
          bountyId: created.id,
          githubId: 2_000_003n,
          githubLogin: "bob",
          userId: bobId,
          role: "pool",
          frozenAt,
          shareUsdc: "7.350000",
        },
      ]);

      const winner = await claimPayout(
        created.id,
        hunterId,
        { payoutAddress: HUNTER_ADDRESS, claimId: claim?.id },
        { db, rail },
      );
      assert.equal(winner.bountyStatus, "settled_partial");
      assert.equal(winner.claimStatus, "paid");
      assert.equal(winner.winnerUsdc, "83.300000");
      assert.ok(winner.payoutTxHash?.startsWith("mock:"));
      assert.ok(winner.feeTxHash?.startsWith("mock:"));

      const [bounty] = await db.select().from(bounties).where(eq(bounties.id, created.id));
      assert.equal(bounty?.status, "settled_partial");
      const [paid] = await db.select().from(claims).where(eq(claims.id, claim!.id));
      assert.equal(paid?.status, "paid");
      const poolLegs = (await db.select().from(allocationLedger).where(eq(allocationLedger.bountyId, created.id)))
        .filter((row) => row.kind === "POOL_PAYOUT");
      assert.equal(poolLegs.length, 2);
      assert.equal(poolLegs.filter((row) => row.txHash).length, 0);

      await assert.rejects(
        () => claimPoolPayout(created.id, hunterId, { payoutAddress: HUNTER_ADDRESS }, { db, rail }),
        (err: unknown) => err instanceof ClaimError && err.code === "not_pool_member",
      );

      const firstPool = await claimPoolPayout(
        created.id,
        aliceId,
        { payoutAddress: OTHER_ADDRESS },
        { db, rail },
      );
      assert.equal(firstPool.bountyStatus, "settled_partial");
      assert.equal(firstPool.poolShareUsdc, "7.350000");
      const afterAlice = (await db.select().from(allocationLedger).where(eq(allocationLedger.bountyId, created.id)))
        .filter((row) => row.kind === "POOL_PAYOUT" && row.txHash);
      assert.equal(afterAlice.length, 1);

      const replay = await claimPoolPayout(
        created.id,
        aliceId,
        { payoutAddress: OTHER_ADDRESS },
        { db, rail },
      );
      assert.equal(replay.payoutTxHash, firstPool.payoutTxHash);
      const aliceHash = afterAlice[0]?.txHash;
      const afterReplay = (await db.select().from(allocationLedger).where(eq(allocationLedger.bountyId, created.id)))
        .filter((row) => row.kind === "POOL_PAYOUT" && row.participantId === afterAlice[0]?.participantId);
      assert.equal(afterReplay[0]?.txHash, aliceHash);

      const rest = await claimPoolPayout(
        created.id,
        bobId,
        { payoutAddress: "0x3333333333333333333333333333333333333333" },
        { db, rail },
      );
      assert.equal(rest.bountyStatus, "settled");
      const paidPool = (await db.select().from(allocationLedger).where(eq(allocationLedger.bountyId, created.id)))
        .filter((row) => row.kind === "POOL_PAYOUT" && row.txHash);
      assert.equal(paidPool.length, 2);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
