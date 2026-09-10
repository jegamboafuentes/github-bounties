import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createBountyFromIssueUrl } from "../bounties/create";
import { fundBounty } from "../bounties/fund";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, claims, feeLedger, repos, users } from "../db/schema";
import { createMockRail } from "../escrow/rail";
import { probeCdpEnv } from "../escrow/env";
import { ClaimError } from "./errors";
import { claimPayout } from "./payout";

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
  return { db, sql, posterId, hunterId, otherId, fullName, rail };
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
});
