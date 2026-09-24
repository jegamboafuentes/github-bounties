import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createBountyFromIssueUrl } from "../bounties/create";
import { fundBounty, topUpBounty } from "../bounties/fund";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, claims, escrows, repos, users } from "../db/schema";
import { EscrowError } from "./errors";
import { probeCdpEnv } from "./env";
import { recordExactInbound } from "./inbound";
import { createMockRail, MOCK_ESCROW_ADDRESS } from "./rail";
import { refundEscrow, settleEscrow } from "./service";

loadDotenvFiles();

const POSTER_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HUNTER_ADDRESS = "0x1111111111111111111111111111111111111111";
const ATTACKER_ADDRESS = "0x9999999999999999999999999999999999999999";

async function fixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const hunterId = randomUUID();
  const attackerId = randomUUID();
  const fullName = `test/sec-${suffix}`;
  const githubRepoId = BigInt(83_000_000 + Number.parseInt(suffix.slice(0, 6), 16));
  await db.insert(users).values([
    {
      id: posterId,
      googleSub: `poster-sec-${suffix}`,
      email: `poster-sec-${suffix}@example.com`,
      displayName: "Ada Poster",
      walletAddress: POSTER_ADDRESS,
    },
    {
      id: hunterId,
      googleSub: `hunter-sec-${suffix}`,
      email: `hunter-sec-${suffix}@example.com`,
      displayName: "Hunter",
      walletAddress: HUNTER_ADDRESS,
    },
    {
      id: attackerId,
      googleSub: `attacker-sec-${suffix}`,
      email: `attacker-sec-${suffix}@example.com`,
      displayName: "Attacker",
      walletAddress: ATTACKER_ADDRESS,
    },
  ]);
  await db.insert(repos).values({
    id: randomUUID(),
    githubRepoId,
    fullName,
    installationId: BigInt(9100),
    connectedByUserId: posterId,
    isActive: true,
  });
  const rail = createMockRail(probeCdpEnv({}));
  return { db, sql, suffix, posterId, hunterId, attackerId, fullName, rail };
}

async function postBounty(
  db: ReturnType<typeof createDb>["db"],
  posterId: string,
  fullName: string,
  issue: number,
  amount = "10",
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

function cdpLikeRail() {
  const rail = createMockRail(probeCdpEnv({}));
  (rail as { mode: "cdp" }).mode = "cdp";
  rail.missingEnv = [];
  return rail;
}

describe("escrow security hotfix", () => {
  it("rejects a non-poster non-winner settle that supplies hunter fields and pays nothing", async () => {
    const { db, sql, posterId, hunterId, attackerId, fullName, rail } = await fixture();
    const transfers: string[] = [];
    const orig = rail.transferUsdc.bind(rail);
    rail.transferUsdc = async (input) => {
      transfers.push(input.to);
      return orig(input);
    };
    try {
      const created = await postBounty(db, posterId, fullName, 1, "40");
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      await db.insert(claims).values({
        bountyId: created.id,
        hunterUserId: hunterId,
        status: "eligible",
        prNumber: 7,
        payoutAddress: HUNTER_ADDRESS,
      });
      await assert.rejects(
        () =>
          settleEscrow(
            created.id,
            {
              actorUserId: attackerId,
              hunterUserId: attackerId,
              hunterPayoutAddress: ATTACKER_ADDRESS,
            } as { actorUserId: string },
            { db, rail },
          ),
        (err: unknown) => err instanceof EscrowError && err.code === "not_settler",
      );
      assert.equal(transfers.length, 0);
      const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(escrow?.payoutTxHash, null);
      assert.equal(escrow?.status, "funded");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("rejects a poster settle when there is no eligible claim", async () => {
    const { db, sql, posterId, fullName, rail } = await fixture();
    const transfers: string[] = [];
    rail.transferUsdc = async (input) => {
      transfers.push(input.to);
      return { txHash: "mock:should-not-send" };
    };
    try {
      const created = await postBounty(db, posterId, fullName, 2, "25");
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      await assert.rejects(
        () =>
          settleEscrow(
            created.id,
            {
              actorUserId: posterId,
              hunterPayoutAddress: ATTACKER_ADDRESS,
            } as { actorUserId: string },
            { db, rail },
          ),
        (err: unknown) => err instanceof EscrowError && err.code === "not_settleable",
      );
      assert.equal(transfers.length, 0);
      const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(escrow?.status, "funded");
      assert.equal(escrow?.payoutTxHash, null);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("rejects a pasted fake hash on the cdp rail for Lock and top-up, and accepts it on mock", async () => {
    const { db, sql, posterId, attackerId, fullName, rail, suffix } = await fixture();
    const cdp = cdpLikeRail();
    const fake = `0xfake${suffix}00000000000000000000000000000000000000000000000001`;
    const pasted = `0xmockpaste${suffix}00000000000000000000000000000000000000000001`;
    const topFake = `0xtopfake${suffix}0000000000000000000000000000000000000000000001`;
    try {
      const created = await postBounty(db, posterId, fullName, 3, "12");
      await assert.rejects(
        () => fundBounty(created.id, posterId, db, new Date(), { rail: cdp, fundTxHash: fake }),
        (err: unknown) => err instanceof EscrowError && err.code === "fund_hash_not_verified",
      );
      const [stillPending] = await db.select().from(bounties).where(eq(bounties.id, created.id));
      assert.equal(stillPending?.status, "pending_fund");

      const funded = await fundBounty(created.id, posterId, db, new Date(), {
        rail,
        fundTxHash: pasted,
      });
      assert.equal(funded.fundTxHash, pasted);

      await assert.rejects(
        () =>
          topUpBounty(
            created.id,
            attackerId,
            { amountUsdc: "4", fundTxHash: topFake },
            db,
            new Date(),
            { rail: cdp },
          ),
        (err: unknown) => err instanceof EscrowError && err.code === "fund_hash_not_verified",
      );
      const [face] = await db.select().from(bounties).where(eq(bounties.id, created.id));
      assert.equal(face?.amountUsdc, "12.000000");

      const topped = await topUpBounty(
        created.id,
        attackerId,
        {
          amountUsdc: "3",
          fundTxHash: `0xmocktop${suffix}000000000000000000000000000000000000000000000001`,
        },
        db,
        new Date(),
        { rail },
      );
      assert.equal(topped.faceUsdc, "15.000000");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("rejects a fund hash reused across bounties", async () => {
    const { db, sql, posterId, fullName, rail, suffix } = await fixture();
    const hash = `0xreuse${suffix}000000000000000000000000000000000000000000000000`;
    try {
      const first = await postBounty(db, posterId, fullName, 4, "8");
      await fundBounty(first.id, posterId, db, new Date(), { rail, fundTxHash: hash });
      const second = await postBounty(db, posterId, fullName, 5, "8");
      await assert.rejects(
        () => fundBounty(second.id, posterId, db, new Date(), { rail, fundTxHash: hash }),
        (err: unknown) => err instanceof EscrowError && err.code === "fund_hash_reused",
      );
      const [row] = await db.select().from(bounties).where(eq(bounties.id, second.id));
      assert.equal(row?.status, "pending_fund");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("refunds the recorded funder and ignores the caller's funderAddress", async () => {
    const { db, sql, posterId, fullName, rail } = await fixture();
    const transfers: string[] = [];
    const orig = rail.transferUsdc.bind(rail);
    rail.transferUsdc = async (input) => {
      transfers.push(input.to);
      return orig(input);
    };
    try {
      const created = await postBounty(db, posterId, fullName, 6, "9");
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      const cancelled = await refundEscrow(
        created.id,
        {
          actorUserId: posterId,
          reason: "cancel",
          funderAddress: ATTACKER_ADDRESS,
        },
        { db, rail },
      );
      assert.equal(cancelled.bountyStatus, "cancelled");
      assert.deepEqual(transfers, [POSTER_ADDRESS]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("blocks a payout leg larger than verified inflows and pays nothing", async () => {
    const { db, sql, posterId, hunterId, fullName, rail } = await fixture();
    let transfers = 0;
    const orig = rail.transferUsdc.bind(rail);
    rail.transferUsdc = async (input) => {
      transfers += 1;
      return orig(input);
    };
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (line?: unknown) => {
      logs.push(String(line));
    };
    try {
      const created = await postBounty(db, posterId, fullName, 7, "10");
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      await db
        .update(bounties)
        .set({ amountUsdc: "1000.000000" })
        .where(eq(bounties.id, created.id));
      await db
        .update(escrows)
        .set({ amountUsdc: "1000.000000" })
        .where(eq(escrows.bountyId, created.id));
      await db.insert(claims).values({
        bountyId: created.id,
        hunterUserId: hunterId,
        status: "eligible",
        prNumber: 8,
        payoutAddress: HUNTER_ADDRESS,
      });
      await assert.rejects(
        () => settleEscrow(created.id, { actorUserId: posterId }, { db, rail }),
        (err: unknown) => err instanceof EscrowError && err.code === "insufficient_bounty_funds",
      );
      assert.equal(transfers, 0);
      assert.ok(logs.some((line) => line.includes("insufficient_bounty_funds")));
      const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(escrow?.payoutTxHash, null);
    } finally {
      console.error = originalError;
      await sql.end({ timeout: 5 });
    }
  });

  it("keeps the x402 payer and never stores the escrow wallet as funder", async () => {
    const { db, sql, posterId, fullName, rail } = await fixture();
    try {
      const created = await postBounty(db, posterId, fullName, 8, "6");
      await assert.rejects(
        () =>
          recordExactInbound(db, {
            bountyId: created.id,
            txHash: `0xpayer${created.id.replace(/-/g, "").slice(0, 20)}00000000000000000000000001`,
            x402PaymentId: "x402:escrow-as-payer",
            escrowAddress: MOCK_ESCROW_ADDRESS,
            resourceUrl: "https://dev.githubbounties.xyz/x402",
            funderAddress: MOCK_ESCROW_ADDRESS,
          }),
        (err: unknown) => err instanceof EscrowError && err.code === "x402_settle_failed",
      );
      const hash = `0xrealpayer${created.id.replace(/-/g, "").slice(0, 16)}000000000000000000000001`;
      await recordExactInbound(db, {
        bountyId: created.id,
        txHash: hash,
        x402PaymentId: `x402:${hash}`,
        escrowAddress: MOCK_ESCROW_ADDRESS,
        resourceUrl: "https://dev.githubbounties.xyz/x402",
        funderAddress: HUNTER_ADDRESS,
      });
      await db.update(users).set({ walletAddress: null }).where(eq(users.id, posterId));
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(escrow?.funderAddress, HUNTER_ADDRESS);
      assert.notEqual(escrow?.funderAddress?.toLowerCase(), MOCK_ESCROW_ADDRESS.toLowerCase());
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
