import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { Attribution } from "ox/erc8021";
import { getAddress } from "viem";
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
import { ERC8021_SUFFIX_MARKER } from "../../escrow/builder-code";
import { probeCdpEnv } from "../../escrow/env";
import { USDC_BASE_SEPOLIA } from "../../lib/constants";
import { createMockRail, MOCK_FEE_ADDRESS, transferUsdcFromAccount, type CdpRail } from "../../escrow/rail";
import type { UsdcSendRequest } from "../../escrow/builder-code";
import { handleMcpHttp } from "../public/mcp-http";
import { handleV1Action } from "./http";
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

async function fixture(rail: CdpRail = createMockRail(probeCdpEnv({}))) {
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

  it("sends REST and MCP payouts through the same rail sendTransaction", async () => {
    const code = "bc_b7k3p9da";
    const feeAddress = getAddress("0xf34b4BDd02FFFf225b1c7779C7A316148b907BA8");
    const escrowAddress = getAddress("0x4a26235bf51c73048635d607EB5371E9b3e611B8");
    const sends: { to: string; idempotencyKey: string; data: string; token: string; network: string }[] = [];
    const rail = createMockRail(probeCdpEnv({}));
    rail.ensureWallets = async () => ({ escrowAddress, feeAddress });
    rail.transferUsdc = async (input) =>
      transferUsdcFromAccount(
        {
          address: escrowAddress,
          async sendTransaction(args: UsdcSendRequest) {
            sends.push({
              to: input.to,
              idempotencyKey: args.idempotencyKey,
              data: args.transaction.data,
              token: args.transaction.to,
              network: args.network,
            });
            const hash = createHash("sha256").update(args.idempotencyKey).digest("hex");
            return { transactionHash: `0x${hash}` };
          },
        },
        input,
        { network: "base-sepolia", unsafeNetwork: false, env: { BASE_BUILDER_CODE: code } },
      );
    const fx = await fixture(rail);
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: fx.posterId,
          issueUrl: `https://github.com/${fx.fullName}/issues/43`,
          amountUsdc: "100",
        },
        { db: fx.db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(created.id, fx.posterId, fx.db, new Date(), { rail: fx.rail });
      await fx.db.insert(claims).values({
        bountyId: created.id,
        hunterUserId: fx.hunterId,
        status: "eligible",
        prNumber: 143,
        prAuthorLogin: "OctoCat",
      });
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
      ]);

      const hunterKey = await createApiKey(
        { userId: fx.hunterId, name: "rest-winner", scopes: ["read", "money"] },
        fx.deps,
      );
      const aliceKey = await createApiKey(
        { userId: fx.aliceId, name: "mcp-pool", scopes: ["read", "money"] },
        fx.deps,
      );
      const posterKey = await createApiKey(
        { userId: fx.posterId, name: "refunds", scopes: ["read", "money"] },
        fx.deps,
      );

      const restClaim = await handleV1Action(
        new Request(`https://dev.githubbounties.xyz/api/v1/bounties/${created.id}/claim`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${hunterKey.token}`,
            "content-type": "application/json",
            "idempotency-key": "rest-winner",
          },
          body: JSON.stringify({ kind: "winner" }),
        }),
        { kind: "claim", bountyId: created.id },
        fx.deps,
      );
      assert.equal(restClaim.status, 200, await restClaim.clone().text());
      const restBody = (await restClaim.json()) as { destination?: string; txHash?: string };
      assert.equal(restBody.destination?.toLowerCase(), HUNTER);
      assert.ok(restBody.txHash?.startsWith("0x"));

      const mcpPool = await handleMcpHttp(
        new Request("https://dev.githubbounties.xyz/mcp", {
          method: "POST",
          headers: {
            authorization: `Bearer ${aliceKey.token}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "claim_pool",
              arguments: { id: created.id, idempotencyKey: "mcp-pool" },
            },
          }),
        }),
        fx.deps,
      );
      assert.equal(mcpPool.status, 200);
      const mcpPoolOuter = (await mcpPool.json()) as {
        result?: { isError?: boolean; content?: { text?: string }[] };
      };
      const mcpPoolBody = JSON.parse(mcpPoolOuter.result?.content?.[0]?.text ?? "{}") as {
        destination?: string;
        error?: { code?: string };
      };
      assert.equal(mcpPoolOuter.result?.isError, false, JSON.stringify(mcpPoolBody));
      assert.equal(mcpPoolBody.destination?.toLowerCase(), ALICE);

      async function fundedRefundBounty(issue: number) {
        const bounty = await createBountyFromIssueUrl(
          {
            posterUserId: fx.posterId,
            issueUrl: `https://github.com/${fx.fullName}/issues/${issue}`,
            amountUsdc: "9",
          },
          { db: fx.db, fetchIssueSnapshot: async () => null },
        );
        await fundBounty(bounty.id, fx.posterId, fx.db, new Date(), { rail: fx.rail });
        await fx.db.update(escrows).set({ funderAddress: RECORDED }).where(eq(escrows.bountyId, bounty.id));
        return bounty.id;
      }

      const restRefundId = await fundedRefundBounty(44);
      const restRefund = await handleV1Action(
        new Request(`https://dev.githubbounties.xyz/api/v1/bounties/${restRefundId}/refund`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${posterKey.token}`,
            "content-type": "application/json",
            "idempotency-key": "rest-refund",
          },
          body: "{}",
        }),
        { kind: "refund", bountyId: restRefundId },
        fx.deps,
      );
      assert.equal(restRefund.status, 200, await restRefund.clone().text());

      const mcpRefundId = await fundedRefundBounty(45);
      const mcpRefund = await handleMcpHttp(
        new Request("https://dev.githubbounties.xyz/mcp", {
          method: "POST",
          headers: {
            authorization: `Bearer ${posterKey.token}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "refund_bounty",
              arguments: { id: mcpRefundId, idempotencyKey: "mcp-refund" },
            },
          }),
        }),
        fx.deps,
      );
      const mcpRefundOuter = (await mcpRefund.json()) as {
        result?: { isError?: boolean; content?: { text?: string }[] };
      };
      const mcpRefundBody = JSON.parse(mcpRefundOuter.result?.content?.[0]?.text ?? "{}") as {
        error?: { code?: string };
      };
      assert.equal(mcpRefundOuter.result?.isError, false, JSON.stringify(mcpRefundBody));

      const dests = sends.map((row) => row.to.toLowerCase());
      assert.equal(dests.filter((to) => to === HUNTER).length, 1);
      assert.equal(dests.filter((to) => to === feeAddress.toLowerCase()).length, 1);
      assert.equal(dests.filter((to) => to === ALICE).length, 1);
      assert.equal(dests.filter((to) => to === RECORDED).length, 2);
      assert.equal(new Set(sends.map((row) => row.idempotencyKey)).size, sends.length);
      for (const row of sends) {
        assert.ok(row.idempotencyKey.length > 0);
        assert.equal(row.network, "base-sepolia");
        assert.equal(row.token, USDC_BASE_SEPOLIA);
        assert.ok(row.data.endsWith(ERC8021_SUFFIX_MARKER));
        assert.deepEqual(Attribution.fromData(row.data as `0x${string}`), { codes: [code], id: 0 });
      }
      assert.equal(fx.transfers.length, sends.length);
    } finally {
      await fx.sql.end({ timeout: 5 });
    }
  });
});
