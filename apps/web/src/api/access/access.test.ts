import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { ApiKeyScope } from "../../db/schema";
import type { FacilitatorSettlementCheck } from "../../escrow/fund-hash";
import type { X402SellerResult } from "../../escrow/x402-seller";
import { atomicToUsdc, usdcToAtomic } from "../../lib/money";
import { PublicApiError } from "../public/errors";
import type { AccessDeps, ApiKeyRecord, SpendRow } from "./deps";
import {
  authenticateBearer,
  createApiKey,
  handleBountyClaims,
  handleCancel,
  handleClaim,
  handleCreateBounty,
  handleFund,
  handleMe,
  handleMyClaims,
  handleRefund,
  handleUsage,
  handleTopUp,
  revokeApiKey,
  runAuthed,
  type ApiPrincipal,
} from "./handlers";
import { apiResultResponse, handleV1Action } from "./http";
import { handleMcpHttp } from "../public/mcp-http";
import {
  apiMoneyEnabled,
  generateApiKey,
  hashApiKey,
  DEV_SPEND_CAPS,
  PROD_SPEND_CAPS,
  spendCeilings,
  type IdempotencyRow,
} from "./policy";

const SECRET = "test-hmac-secret-value";
const USER = "00000000-0000-4000-8000-000000000001";
const BOB = "00000000-0000-4000-8000-0000000000b0";
const MALLORY = "00000000-0000-4000-8000-0000000000c0";
const BOUNTY = "00000000-0000-4000-8000-000000000022";
const CLAIM_ID = "00000000-0000-4000-8000-0000000000c1";
const POOL_ID = "00000000-0000-4000-8000-0000000000d1";
const BOB_POOL_ID = "00000000-0000-4000-8000-0000000000d2";
const RECORDED_PAYER = "0x3333333333333333333333333333333333333333";
const ATTACKER = "0x9999999999999999999999999999999999999999";
const PAY_TO = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function envFor(network = "base-sepolia", extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...extra, CDP_NETWORK: network, API_KEY_HMAC_SECRET: SECRET };
}

function memory(options?: {
  env?: NodeJS.ProcessEnv;
  wallet?: boolean;
  github?: boolean;
  face?: string;
  status?: string;
  poster?: string;
  now?: Date;
  rosterFrozen?: boolean;
}) {
  const keys: ApiKeyRecord[] = [];
  const logs: { id: string; keyId: string; route: string; status: number; createdAt: Date }[] = [];
  const spends: SpendRow[] = [];
  const idem = new Map<string, IdempotencyRow>();
  const calls = { lock: 0, topUp: 0, seller: 0, inbound: 0, cancel: 0, create: 0, claim: 0, refund: 0 };
  const poolPaid = new Set<string>();
  let openSpend = BigInt(0);
  const deps: AccessDeps = {
    env: options?.env ?? envFor(),
    now: () => options?.now ?? new Date("2026-09-24T12:00:00.000Z"),
    async findKeyByHash(hash) {
      return keys.find((row) => row.keyHash === hash) ?? null;
    },
    async insertKey(row) {
      keys.push(row);
    },
    async listKeys(userId) {
      return keys.filter((row) => row.userId === userId);
    },
    async revokeKey(userId, keyId, at) {
      const row = keys.find((item) => item.id === keyId && item.userId === userId);
      if (!row) return false;
      row.revokedAt = at;
      return true;
    },
    async touchKey(keyId, at, ip) {
      const row = keys.find((item) => item.id === keyId);
      if (!row) return;
      row.lastUsedAt = at;
      row.lastUsedIp = ip;
    },
    async insertRequest(row) {
      const id = randomUUID();
      logs.push({ id, keyId: row.keyId, route: row.route, status: row.status, createdAt: row.createdAt });
      return id;
    },
    async updateRequestStatus(id, status) {
      const row = logs.find((item) => item.id === id);
      if (row) row.status = status;
    },
    async countRequests(keyId, routePrefix, since) {
      return logs.filter(
        (row) => row.keyId === keyId && row.route.startsWith(routePrefix) && row.createdAt >= since,
      ).length;
    },
    async sumOpenSpend() {
      return atomicToUsdc(openSpend);
    },
    async listRecentSpend(keyId, limit) {
      const cap = Math.min(Math.max(limit, 1), 50);
      return spends
        .filter((row) => row.keyId === keyId && (row.status === "reserved" || row.status === "recorded"))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
        .slice(0, cap);
    },
    async insertSpend(row) {
      const id = row.id ?? randomUUID();
      spends.push({
        id,
        keyId: row.keyId,
        bountyId: row.bountyId,
        kind: row.kind,
        amountUsdc: row.amountUsdc,
        txHash: row.txHash ?? null,
        status: row.status,
        createdAt: row.createdAt,
      });
      if (row.status === "reserved" || row.status === "recorded") {
        openSpend += usdcToAtomic(row.amountUsdc);
      }
      return id;
    },
    async updateSpend(id, patch) {
      const row = spends.find((item) => item.id === id);
      if (!row) return;
      const wasOpen = row.status === "reserved" || row.status === "recorded";
      row.status = patch.status;
      const isOpen = patch.status === "reserved" || patch.status === "recorded";
      if (wasOpen && !isOpen) openSpend -= usdcToAtomic(row.amountUsdc);
    },
    async findIdempotency(keyId, idempotencyKey) {
      return idem.get(`${keyId}:${idempotencyKey}`) ?? null;
    },
    async saveIdempotency(row) {
      idem.set(`${row.keyId}:${row.idempotencyKey}`, row);
    },
    async moneyGate() {
      return { wallet: options?.wallet !== false, github: options?.github !== false };
    },
    async loadMe(userId) {
      return {
        id: userId,
        displayName: "Ada",
        email: "ada@example.com",
        walletAddress: options?.wallet === false ? null : PAYER,
        githubLogin: options?.github === false ? null : "ada",
      };
    },
    async listMyBounties() {
      return { posted: [], funded: [] };
    },
    async loadMoneyBounty(id) {
      if (id !== BOUNTY) return null;
      return {
        id,
        posterUserId: options?.poster ?? USER,
        status: options?.status ?? "pending_fund",
        amountUsdc: options?.face ?? "10.000000",
        title: "Seed",
        issueUrl: "https://github.com/octo/hello/issues/42",
      };
    },
    async assertTopUpOpen() {},
    async escrowPayTo() {
      return { payTo: PAY_TO, network: "base-sepolia", mode: "cdp" };
    },
    async liveSeller(input) {
      calls.seller += 1;
      assert.ok(input.actorUserId);
      assert.ok(input.moneyAction === "lock" || input.moneyAction === "top_up");
      const facilitatorSettlement = {
        bountyId: input.bountyId,
        action: input.moneyAction,
        actorUserId: input.actorUserId,
      } as FacilitatorSettlementCheck;
      const settled: X402SellerResult = {
        kind: "settled",
        settled: {
          status: 200,
          headers: {},
          txHash: TX,
          payer: PAYER,
          network: "eip155:84532",
          facilitatorSettlement,
        },
      };
      return settled;
    },
    async recordInbound() {
      calls.inbound += 1;
    },
    async lockFunds(input) {
      calls.lock += 1;
      assert.equal(input.fundTxHash, TX);
      assert.equal(input.actorUserId, USER);
      return { fundTxHash: input.fundTxHash, status: "funded" };
    },
    async topUp(input) {
      calls.topUp += 1;
      assert.equal(input.fundTxHash, TX);
      assert.equal(input.payer, PAYER);
      assert.equal(input.facilitatorSettlement?.action, "top_up");
      assert.equal(input.facilitatorSettlement?.bountyId, BOUNTY);
      return { fundTxHash: input.fundTxHash, faceUsdc: "20.000000", amountUsdc: input.amountUsdc };
    },
    async createBounty(input) {
      calls.create += 1;
      return {
        id: BOUNTY,
        status: "pending_fund",
        title: "Issue",
        amountUsdc: input.amountUsdc,
        url: input.issueUrl,
      };
    },
    async signalWorking() {
      return { id: randomUUID(), bountyId: BOUNTY, signaledAt: new Date() };
    },
    async clearSignal() {
      return { cleared: 1 };
    },
    async cancelUnfunded() {
      calls.cancel += 1;
      return { status: "cancelled", refundTxHash: null };
    },
    async loadClaimAuthz(userId, bountyId, kind) {
      if (bountyId !== BOUNTY) {
        return { bounty: null, walletAddress: null, githubLogin: null, winner: null, pool: null, rosterFrozen: false };
      }
      const login = userId === BOB ? "bob" : userId === MALLORY ? "mallory" : options?.github === false ? null : "octocat";
      const wallet = options?.wallet === false ? null : PAYER;
      return {
        bounty: {
          id: BOUNTY,
          title: "Seed",
          status: options?.status ?? "funded",
          amountUsdc: options?.face ?? "10.000000",
          posterUserId: options?.poster ?? USER,
        },
        walletAddress: wallet,
        githubLogin: login,
        winner: {
          claimId: CLAIM_ID,
          hunterUserId: USER,
          prAuthorLogin: "OctoCat",
          status: "eligible",
          amountUsdc: null,
          txHash: null,
          paidAt: null,
        },
        pool:
          kind === "pool" && (userId === USER || userId === BOB)
            ? {
                participantId: userId === BOB ? BOB_POOL_ID : POOL_ID,
                userId,
                githubLogin: login ?? "",
                shareUsdc: "7.350000",
                txHash: poolPaid.has(userId) ? TX : null,
                paidAt: null,
              }
            : null,
        rosterFrozen: options?.rosterFrozen !== false,
      };
    },
    async performClaim(input) {
      calls.claim += 1;
      assert.equal("destination" in input, false);
      assert.equal("payoutAddress" in input, false);
      assert.equal("hunterUserId" in input, false);
      if (input.kind === "pool") poolPaid.add(input.actorUserId);
      return {
        bountyId: input.bountyId,
        kind: input.kind,
        status: "paid",
        bountyStatus: input.kind === "pool" ? "settled_partial" : "settled",
        amountUsdc: input.kind === "pool" ? "7.350000" : "8.330000",
        txHash: TX,
        destination: PAYER,
        claimId: input.kind === "winner" ? CLAIM_ID : null,
        participantId: input.kind === "pool" ? (input.actorUserId === BOB ? BOB_POOL_ID : POOL_ID) : null,
        legs: [
          {
            destination: PAYER,
            amount: input.kind === "pool" ? "7.350000" : "8.330000",
            kind: input.kind === "pool" ? "POOL_PAYOUT" : "WINNER_PAYOUT",
            status: "paid" as const,
            txHash: TX,
            reason: null,
          },
        ],
      };
    },
    async performRefund(input) {
      calls.refund += 1;
      const keys = Object.keys(input).sort();
      assert.deepEqual(keys, ["actorUserId", "apiKeyId", "bountyId", "requestId"]);
      return {
        bountyId: input.bountyId,
        status: "cancelled",
        refundTxHash: TX,
        amountUsdc: options?.face ?? "10.000000",
        destination: RECORDED_PAYER,
        legs: [
          {
            destination: RECORDED_PAYER,
            amount: options?.face ?? "10.000000",
            kind: "REFUND_OUT",
            status: "paid" as const,
            txHash: TX,
            reason: null,
          },
        ],
      };
    },
    async listClaims(userId, bountyId) {
      if (bountyId && bountyId !== BOUNTY) throw new PublicApiError("not_found", "Bounty not found.");
      if (userId !== USER && userId !== BOB) return [];
      return [
        {
          bountyId: BOUNTY,
          title: "Seed",
          kind: userId === BOB ? ("pool" as const) : ("winner" as const),
          status: "paid",
          amountUsdc: userId === BOB ? "7.350000" : "8.330000",
          txHash: TX,
          paidAt: "2026-09-24T12:00:00.000Z",
          destination: PAYER,
        },
      ];
    },
  };
  return { deps, keys, calls, spends, poolPaid, setOpenSpend: (usdc: string) => { openSpend = usdcToAtomic(usdc); } };
}

async function principal(
  deps: AccessDeps,
  scopes: ApiKeyScope[] = ["read", "write", "money"],
  caps?: { perTx?: string; daily?: string },
  userId = USER,
): Promise<{ token: string; principal: ApiPrincipal }> {
  const created = await createApiKey(
    {
      userId,
      name: "agent",
      scopes,
      perTxCapUsdc: caps?.perTx,
      dailyCapUsdc: caps?.daily,
    },
    deps,
  );
  const authed = await authenticateBearer(`Bearer ${created.token}`, "203.0.113.10", deps);
  assert.ok(authed);
  return { token: created.token, principal: authed };
}

describe("API key hashing and bearer auth", () => {
  it("stores HMAC-SHA256 and shows gb_test_ once", async () => {
    const { deps, keys } = memory();
    const created = await createApiKey({ userId: USER, name: "laptop", scopes: ["read"] }, deps);
    assert.match(created.token, /^gb_test_[A-Za-z0-9_-]{43,}$/);
    assert.equal(Buffer.from(created.token.slice("gb_test_".length), "base64url").length >= 32, true);
    assert.equal(created.key.prefix, created.token.slice(0, "gb_test_".length + 8));
    assert.equal(keys[0]?.keyHash, hashApiKey(created.token, SECRET));
    assert.equal(JSON.stringify(keys[0]).includes(created.token), false);
    const again = generateApiKey(envFor("base"));
    assert.match(again.token, /^gb_live_/);
    assert.notEqual(hashApiKey(created.token, SECRET), hashApiKey(created.token, "another-hmac-secret"));
  });

  it("accepts only Bearer, rejects revoked keys, and ignores cookies", async () => {
    const { deps } = memory();
    const created = await createApiKey({ userId: USER, name: "laptop", scopes: ["read", "write"] }, deps);
    assert.equal(await authenticateBearer(null, "203.0.113.9", deps), null);
    await assert.rejects(
      () => authenticateBearer("Basic abc", "203.0.113.9", deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "unauthorized",
    );
    const authed = await authenticateBearer(`Bearer ${created.token}`, "203.0.113.9", deps);
    assert.equal(authed?.userId, USER);
    assert.equal(authed?.prefix, created.key.prefix);
    await revokeApiKey(USER, created.key.id, deps);
    await assert.rejects(
      () => authenticateBearer(`Bearer ${created.token}`, "203.0.113.9", deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "key_revoked",
    );
  });
});

describe("scopes, money gate, and the mainnet flag", () => {
  it("write scope is required to post", async () => {
    const bag = memory();
    const { principal: reader } = await principal(bag.deps, ["read"]);
    await assert.rejects(
      () => handleCreateBounty(reader, { issueUrl: "https://github.com/octo/hello/issues/1", amountUsdc: "5" }, bag.deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "forbidden_scope",
    );
    assert.equal(bag.calls.create, 0);
  });

  it("money scope requires a saved wallet and linked GitHub", async () => {
    const noWallet = memory({ wallet: false, github: true });
    await assert.rejects(
      () => createApiKey({ userId: USER, name: "pay", scopes: ["money"] }, noWallet.deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "wallet_not_set",
    );
    const noGithub = memory({ wallet: true, github: false });
    await assert.rejects(
      () => createApiKey({ userId: USER, name: "pay", scopes: ["money"] }, noGithub.deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "github_not_linked",
    );
    const gated = memory({ wallet: false, github: true });
    const { principal: payer } = await principal(gated.deps, ["read", "write"]);
    payer.scopes.add("money");
    await assert.rejects(
      () => handleFund(payer, BOUNTY, {}, "idem-1", null, "https://dev.githubbounties.xyz", gated.deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "wallet_not_set",
    );
  });

  it("refuses caps above the env ceiling", async () => {
    const bag = memory();
    await assert.rejects(
      () =>
        createApiKey(
          { userId: USER, name: "high", scopes: ["read"], perTxCapUsdc: "50.01", dailyCapUsdc: "200" },
          bag.deps,
        ),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "validation_failed",
    );
  });

  it("defaults money off on mainnet and on for base-sepolia", () => {
    assert.equal(apiMoneyEnabled({ CDP_NETWORK: "base" }), false);
    assert.equal(apiMoneyEnabled({ CDP_NETWORK: "base-mainnet" }), false);
    assert.equal(apiMoneyEnabled({ CDP_NETWORK: "eip155:8453" }), false);
    assert.equal(apiMoneyEnabled({ CDP_NETWORK: "base-sepolia" }), true);
    assert.equal(apiMoneyEnabled({}), true);
    assert.equal(apiMoneyEnabled({ CDP_NETWORK: "base-sepolia", API_MONEY_ENABLED: "0" }), false);
    assert.equal(apiMoneyEnabled({ CDP_NETWORK: "base", API_MONEY_ENABLED: "false" }), false);
    assert.deepEqual(spendCeilings({ CDP_NETWORK: "base-sepolia" }), DEV_SPEND_CAPS);
    assert.deepEqual(spendCeilings({ CDP_NETWORK: "base" }), PROD_SPEND_CAPS);
    const bag = memory({ env: envFor("base") });
    return principal(bag.deps, ["money"]).then(async ({ principal: payer }) => {
      await assert.rejects(
        () => handleFund(payer, BOUNTY, {}, "idem-mainnet", null, "https://githubbounties.xyz", bag.deps),
        (err: unknown) => err instanceof Error && "code" in err && err.code === "forbidden_scope",
      );
      assert.equal(bag.calls.seller, 0);
    });
  });
});

describe("per-key rate limits", () => {
  it("allows 120 reads, 20 writes, and 10 money calls", async () => {
    const bag = memory();
    const { principal: key } = await principal(bag.deps, ["read", "write", "money"]);
    const ok = async () => ({ status: 200, body: { ok: true } });
    for (let i = 0; i < 120; i += 1) {
      const result = await runAuthed({ principal: key, klass: "read", route: "GET /api/v1/me", bountyId: null, ip: "1.1.1.1" }, bag.deps, ok);
      assert.equal(result.status, 200);
    }
    await assert.rejects(
      () => runAuthed({ principal: key, klass: "read", route: "GET /api/v1/me", bountyId: null, ip: "1.1.1.1" }, bag.deps, ok),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "rate_limited",
    );
    for (let i = 0; i < 20; i += 1) {
      await runAuthed({ principal: key, klass: "write", route: "POST /api/v1/bounties", bountyId: null, ip: "1.1.1.1" }, bag.deps, ok);
    }
    await assert.rejects(
      () => runAuthed({ principal: key, klass: "write", route: "POST /api/v1/bounties", bountyId: null, ip: "1.1.1.1" }, bag.deps, ok),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "rate_limited",
    );
    for (let i = 0; i < 10; i += 1) {
      await runAuthed({ principal: key, klass: "money", route: "POST /api/v1/bounties/x/fund", bountyId: BOUNTY, ip: "1.1.1.1" }, bag.deps, ok);
    }
    await assert.rejects(
      () => runAuthed({ principal: key, klass: "money", route: "POST /api/v1/bounties/x/fund", bountyId: BOUNTY, ip: "1.1.1.1" }, bag.deps, ok),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "rate_limited",
    );
  });
});

describe("spend caps, idempotency, and headless x402", () => {
  it("blocks a payment above the per-transaction cap and the daily cap", async () => {
    const perTx = memory({ face: "50.010000" });
    const { principal: key } = await principal(perTx.deps, ["money"], { perTx: "50", daily: "200" });
    await assert.rejects(
      () => handleFund(key, BOUNTY, {}, "cap-tx", null, "https://dev.githubbounties.xyz", perTx.deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "spend_cap_exceeded",
    );
    assert.equal(perTx.calls.seller, 0);

    const daily = memory({ face: "30.000000" });
    daily.setOpenSpend("180.000000");
    const { principal: dayKey } = await principal(daily.deps, ["money"], { perTx: "50", daily: "200" });
    await assert.rejects(
      () => handleFund(dayKey, BOUNTY, {}, "cap-day", null, "https://dev.githubbounties.xyz", daily.deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "spend_cap_exceeded",
    );
    assert.equal(daily.calls.seller, 0);
    assert.equal(daily.calls.lock, 0);
  });

  it("checks the daily cap again after reserving and before lock", async () => {
    const bag = memory({ face: "20.000000" });
    const { principal: key } = await principal(bag.deps, ["money"], { perTx: "50", daily: "200" });
    const original = bag.deps.sumOpenSpend;
    let calls = 0;
    bag.deps.sumOpenSpend = async (...args) => {
      calls += 1;
      if (calls === 1) return "0.000000";
      return "210.000000";
    };
    await assert.rejects(
      () =>
        handleFund(key, BOUNTY, {}, "cap-race", "signed-payment", "https://dev.githubbounties.xyz", bag.deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "spend_cap_exceeded",
    );
    assert.equal(bag.calls.seller, 0);
    assert.equal(bag.calls.lock, 0);
    assert.equal(bag.spends.some((row) => row.status === "failed"), true);
    bag.deps.sumOpenSpend = original;
  });

  it("replays the same idempotency key and conflicts on a different body", async () => {
    const bag = memory();
    const { principal: key } = await principal(bag.deps, ["write", "money"]);
    const first = await handleCancel(key, BOUNTY, "cancel-1", bag.deps);
    const second = await handleCancel(key, BOUNTY, "cancel-1", bag.deps);
    assert.equal(first.status, 200);
    assert.deepEqual(second.body, first.body);
    assert.equal(bag.calls.cancel, 1);

    const topUp = memory({ status: "funded", face: "10.000000" });
    const { principal: payer } = await principal(topUp.deps, ["money"]);
    await handleTopUp(payer, BOUNTY, { amountUsdc: "5" }, "top-1", "sig", "https://dev.githubbounties.xyz", topUp.deps);
    assert.equal(topUp.calls.topUp, 1);
    const replay = await handleTopUp(
      payer,
      BOUNTY,
      { amountUsdc: "5" },
      "top-1",
      "sig",
      "https://dev.githubbounties.xyz",
      topUp.deps,
    );
    assert.equal(replay.status, 200);
    assert.equal(topUp.calls.topUp, 1);
    await assert.rejects(
      () => handleTopUp(payer, BOUNTY, { amountUsdc: "6" }, "top-1", "sig", "https://dev.githubbounties.xyz", topUp.deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "idempotency_conflict",
    );
  });

  it("returns 402 then settles through the facilitator into lock and top-up", async () => {
    const bag = memory({ face: "10.000000" });
    const { principal: key } = await principal(bag.deps, ["money"]);
    const challenge = await handleFund(key, BOUNTY, {}, "fund-1", null, "https://dev.githubbounties.xyz", bag.deps);
    assert.equal(challenge.status, 402);
    const body = challenge.body as { error: { code: string; details: { approval_url: string; payTo: string; paymentRequired: { accepts: { payTo: string; amount: string }[] } } } };
    assert.equal(body.error.code, "payment_required");
    assert.equal(body.error.details.payTo, PAY_TO);
    assert.equal(body.error.details.paymentRequired.accepts[0]?.payTo, PAY_TO);
    assert.match(body.error.details.approval_url, /\/bounties\/00000000-0000-4000-8000-000000000022$/);
    assert.match(challenge.headers?.["PAYMENT-REQUIRED"] ?? "", /.+/)
    assert.equal(bag.calls.seller, 0);
    assert.equal(bag.calls.lock, 0);

    const settled = await handleFund(
      key,
      BOUNTY,
      {},
      "fund-1",
      "signed-payment",
      "https://dev.githubbounties.xyz",
      bag.deps,
    );
    assert.equal(settled.status, 200);
    assert.equal(bag.calls.seller, 1);
    assert.equal(bag.calls.inbound, 1);
    assert.equal(bag.calls.lock, 1);
    assert.equal((settled.body as { fundTxHash: string }).fundTxHash, TX);
    const replay = await handleFund(key, BOUNTY, {}, "fund-1", "signed-payment", "https://dev.githubbounties.xyz", bag.deps);
    assert.equal(replay.status, 200);
    assert.equal(bag.calls.seller, 1);

    const top = memory({ status: "funded" });
    const { principal: payer } = await principal(top.deps, ["money"]);
    const unpaid = await handleTopUp(payer, BOUNTY, { amountUsdc: "4" }, "up-1", null, "https://dev.githubbounties.xyz", top.deps);
    assert.equal(unpaid.status, 402);
    const paid = await handleTopUp(payer, BOUNTY, { amountUsdc: "4" }, "up-1", "signed-payment", "https://dev.githubbounties.xyz", top.deps);
    assert.equal(paid.status, 200);
    assert.equal(top.calls.seller, 1);
    assert.equal(top.calls.topUp, 1);
    assert.equal(top.calls.lock, 0);
  });

  it("rejects a body that carries an address and never calls the facilitator", async () => {
    const bag = memory();
    const { principal: key } = await principal(bag.deps, ["money"]);
    const address = "0x3333333333333333333333333333333333333333";
    await assert.rejects(
      () => handleFund(key, BOUNTY, { walletAddress: address }, "addr-1", null, "https://dev.githubbounties.xyz", bag.deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "validation_failed",
    );
    await assert.rejects(
      () =>
        handleTopUp(
          key,
          BOUNTY,
          { amountUsdc: "4", payTo: address },
          "addr-2",
          "signed-payment",
          "https://dev.githubbounties.xyz",
          bag.deps,
        ),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "validation_failed",
    );
    assert.equal(bag.calls.seller, 0);
    assert.equal(bag.calls.lock, 0);
    assert.equal(bag.calls.topUp, 0);
  });

  it("rejects a non-uuid bounty id before any money work", async () => {
    const bag = memory();
    const { principal: key } = await principal(bag.deps, ["write", "money"]);
    await assert.rejects(
      () => handleFund(key, "not-a-uuid", {}, "bad-id", null, "https://dev.githubbounties.xyz", bag.deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "validation_failed",
    );
    await assert.rejects(
      () => handleCancel(key, "not-a-uuid", "bad-cancel", bag.deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "validation_failed",
    );
    assert.equal(bag.calls.seller, 0);
    assert.equal(bag.calls.lock, 0);
  });

  it("requires the read scope for /me", async () => {
    const bag = memory();
    const { principal: key } = await principal(bag.deps, ["write"]);
    await assert.rejects(
      () => handleMe(key, bag.deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "forbidden_scope",
    );
  });

  it("omits google_sub from /me", async () => {
    const bag = memory();
    const { principal: key } = await principal(bag.deps, ["read"]);
    const me = await handleMe(key, bag.deps);
    const json = JSON.stringify(me.body);
    assert.equal(json.includes("google_sub"), false);
    assert.equal(json.includes("googleSub"), false);
    assert.match(json, /ada@example.com/);
    const readKey = me.body as { apiKey: { perTxCapUsdc: string | null; dailyCapUsdc: string | null } };
    assert.equal(readKey.apiKey.perTxCapUsdc, null);
    assert.equal(readKey.apiKey.dailyCapUsdc, null);
    const { principal: moneyKey } = await principal(bag.deps, ["read", "money"]);
    const moneyMe = await handleMe(moneyKey, bag.deps);
    const moneyBody = moneyMe.body as { apiKey: { perTxCapUsdc: string | null; dailyCapUsdc: string | null } };
    assert.match(moneyBody.apiKey.perTxCapUsdc ?? "", /^\d+\.\d{6}$/);
    assert.match(moneyBody.apiKey.dailyCapUsdc ?? "", /^\d+\.\d{6}$/);
  });

  it("returns already_cancelled and does not cancel again", async () => {
    const bag = memory({ status: "cancelled" });
    const { token } = await principal(bag.deps, ["write"]);
    const response = await handleV1Action(
      new Request(`https://dev.githubbounties.xyz/api/v1/bounties/${BOUNTY}/cancel`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": "cancel-again",
        },
      }),
      { kind: "cancel", bountyId: BOUNTY },
      bag.deps,
    );
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("ratelimit-limit"), "20");
    assert.equal(response.headers.get("ratelimit-reset"), "60");
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "already_cancelled");
    assert.match(body.error.message, /already cancelled/);
    assert.equal(bag.calls.cancel, 0);
  });

  it("replays a stored 409 with the original JSON bytes", async () => {
    const bag = memory({ status: "cancelled" });
    let stored: unknown;
    const save = bag.deps.saveIdempotency.bind(bag.deps);
    bag.deps.saveIdempotency = async (row) => {
      stored = row.responseBody;
      await save(row);
    };
    const { token } = await principal(bag.deps, ["write"]);
    const first = await handleV1Action(
      new Request(`https://dev.githubbounties.xyz/api/v1/bounties/${BOUNTY}/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "idempotency-key": "cancel-bytes" },
      }),
      { kind: "cancel", bountyId: BOUNTY },
      bag.deps,
    );
    const firstText = await first.text();
    const raw = stored as { __raw?: string };
    assert.equal(raw.__raw, firstText);
    const replay = await handleV1Action(
      new Request(`https://dev.githubbounties.xyz/api/v1/bounties/${BOUNTY}/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "idempotency-key": "cancel-bytes" },
      }),
      { kind: "cancel", bountyId: BOUNTY },
      bag.deps,
    );
    assert.equal(await replay.text(), firstText);
    assert.equal(bag.calls.cancel, 0);
  });

  it("returns this key's usage and hides other keys", async () => {
    const bag = memory();
    const { principal: mine } = await principal(bag.deps, ["read", "money"], { perTx: "10", daily: "40" });
    const { principal: other } = await principal(bag.deps, ["read"]);
    const now = new Date("2026-09-24T12:00:00.000Z");
    await bag.deps.insertSpend({
      keyId: mine.keyId,
      bountyId: BOUNTY,
      kind: "fund",
      amountUsdc: "5.000000",
      txHash: TX,
      status: "recorded",
      createdAt: now,
    });
    await bag.deps.insertSpend({
      keyId: other.keyId,
      bountyId: BOUNTY,
      kind: "top_up",
      amountUsdc: "9.000000",
      txHash: TX,
      status: "recorded",
      createdAt: new Date("2026-09-24T13:00:00.000Z"),
    });
    await bag.deps.insertSpend({
      keyId: mine.keyId,
      bountyId: BOUNTY,
      kind: "fund",
      amountUsdc: "1.000000",
      txHash: null,
      status: "failed",
      createdAt: now,
    });
    bag.setOpenSpend("5.000000");
    const usage = await handleUsage(mine, bag.deps);
    const body = usage.body as {
      perTxCapUsdc: string;
      dailyCapUsdc: string;
      spentTodayUsdc: string;
      remainingTodayUsdc: string;
      entries: { amountUsdc: string; kind: string; bountyId: string; txHash: string | null; createdAt: string }[];
    };
    assert.equal(body.perTxCapUsdc, "10.000000");
    assert.equal(body.dailyCapUsdc, "40.000000");
    assert.equal(body.spentTodayUsdc, "5.000000");
    assert.equal(body.remainingTodayUsdc, "35.000000");
    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0]?.kind, "fund");
    assert.equal(body.entries[0]?.bountyId, BOUNTY);
    assert.equal(body.entries[0]?.txHash, TX);
    assert.equal(JSON.stringify(body).includes("9.000000"), false);
    const { principal: reader } = await principal(bag.deps, ["read"]);
    const hidden = await handleUsage(reader, bag.deps);
    const hiddenBody = hidden.body as {
      perTxCapUsdc: string | null;
      dailyCapUsdc: string | null;
      spentTodayUsdc: string | null;
      remainingTodayUsdc: string | null;
    };
    assert.equal(hiddenBody.perTxCapUsdc, null);
    assert.equal(hiddenBody.dailyCapUsdc, null);
    assert.equal(hiddenBody.spentTodayUsdc, null);
    assert.equal(hiddenBody.remainingTodayUsdc, null);
    const { principal: writer } = await principal(bag.deps, ["write"]);
    await assert.rejects(
      () => handleUsage(writer, bag.deps),
      (err: unknown) => err instanceof Error && "code" in err && err.code === "forbidden_scope",
    );
  });

  it("puts RateLimit headers on keyed 4xx and WWW-Authenticate on 401", async () => {
    const bag = memory();
    const { token } = await principal(bag.deps, ["write"]);
    const denied = await handleV1Action(
      new Request("https://dev.githubbounties.xyz/api/v1/me", {
        headers: { authorization: `Bearer ${token}`, cookie: "authjs.session-token=not-a-jwt" },
      }),
      { kind: "me" },
      bag.deps,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("ratelimit-limit"), "120");
    assert.equal(denied.headers.get("ratelimit-remaining"), "119");
    assert.equal(denied.headers.get("ratelimit-reset"), "60");
    assert.equal(denied.headers.get("www-authenticate"), null);
    assert.equal(denied.headers.get("set-cookie"), null);

    const { token: readToken } = await principal(bag.deps, ["read"]);
    const allowed = await handleV1Action(
      new Request("https://dev.githubbounties.xyz/api/v1/me", {
        headers: { authorization: `Bearer ${readToken}` },
      }),
      { kind: "me" },
      bag.deps,
    );
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("ratelimit-limit"), "120");
    assert.equal(allowed.headers.get("ratelimit-remaining"), "119");
    assert.equal(allowed.headers.get("ratelimit-reset"), "60");

    const anon = await handleV1Action(
      new Request("https://dev.githubbounties.xyz/api/v1/me", {
        headers: { cookie: "authjs.session-token=not-a-jwt" },
      }),
      { kind: "me" },
      bag.deps,
    );
    assert.equal(anon.status, 401);
    assert.equal(anon.headers.get("www-authenticate"), "Bearer");
    assert.equal(anon.headers.get("ratelimit-limit"), "120");
    assert.equal(anon.headers.get("ratelimit-remaining"), "120");
    const anonBody = (await anon.json()) as { error: { code: string } };
    assert.equal(anonBody.error.code, "unauthorized");

    const shaped = apiResultResponse({ status: 401, body: { error: { code: "unauthorized", message: "no", details: null } } });
    assert.equal(shaped.headers.get("www-authenticate"), "Bearer");

    const mcp = await handleMcpHttp(
      new Request("https://dev.githubbounties.xyz/mcp", {
        method: "POST",
        headers: { authorization: "Bearer not-a-key", "content-type": "application/json" },
        body: "{}",
      }),
      bag.deps,
    );
    assert.equal(mcp.status, 401);
    assert.equal(mcp.headers.get("ratelimit-limit"), "120");
    assert.equal(mcp.headers.get("ratelimit-remaining"), "120");
    assert.equal(mcp.headers.get("ratelimit-reset"), "60");

    const { token: mcpToken } = await principal(bag.deps, ["read"]);
    const called = await handleMcpHttp(
      new Request("https://dev.githubbounties.xyz/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${mcpToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_me", arguments: {} },
        }),
      }),
      bag.deps,
    );
    assert.equal(called.status, 200);
    assert.equal(called.headers.get("ratelimit-limit"), "120");
    assert.equal(called.headers.get("ratelimit-remaining"), "119");
    assert.equal(called.headers.get("ratelimit-reset"), "60");
    const mcpBody = await called.json();
    const text = JSON.stringify(mcpBody);
    assert.match(text, /ada@example.com/);
    assert.equal(text.includes("50.000000"), false);
  });
});

describe("production money wiring", () => {
  it("calls lockEscrowFunds, topUpFundedBounty, and the x402 seller", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "store.ts"), "utf8");
    assert.match(source, /lockEscrowFunds\(/);
    assert.match(source, /topUpFundedBounty\(/);
    assert.match(source, /fundHashSource: "x402"/);
    assert.match(source, /facilitatorSettlement: input\.facilitatorSettlement/);
    assert.match(source, /processLiveX402Exact\(/);
    assert.match(source, /moneyAction: input\.moneyAction/);
    assert.match(source, /actorUserId: input\.actorUserId/);
    assert.match(source, /recordExactInbound\(/);
    assert.doesNotMatch(source, /fundTxHash:\s*body/);
    const claimFn = source.slice(source.indexOf("async performClaim"), source.indexOf("async performRefund"));
    assert.match(claimFn, /claimPayout\(/);
    assert.match(claimFn, /claimPoolPayout\(/);
    assert.match(claimFn, /persistWallet: false/);
    assert.doesNotMatch(claimFn, /payoutAddress: input/);
    const refundFn = source.slice(source.indexOf("async performRefund"), source.indexOf("async listClaims"));
    assert.match(refundFn, /actorUserId: input\.actorUserId, reason: "cancel"/);
    assert.doesNotMatch(refundFn, /funderAddress:\s*(input|body|args)/);
  });
});

function codeOf(err: unknown): string {
  return err && typeof err === "object" && "code" in err && typeof err.code === "string" ? err.code : "";
}

describe("V4-3 claims, status, and funded refund", () => {
  it("rejects an address, a destination, and a user id before any payout", async () => {
    const bag = memory();
    const { principal: key } = await principal(bag.deps);
    const lines: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      await assert.rejects(
        () => handleClaim(key, BOUNTY, { kind: "winner", payoutAddress: ATTACKER }, "claim-addr", bag.deps),
        (err: unknown) => codeOf(err) === "validation_failed",
      );
      await assert.rejects(
        () => handleClaim(key, BOUNTY, { kind: "winner", destination: ATTACKER }, "claim-dest", bag.deps),
        (err: unknown) => codeOf(err) === "validation_failed",
      );
      await assert.rejects(
        () => handleClaim(key, BOUNTY, { kind: "winner", hunterUserId: MALLORY }, "claim-user", bag.deps),
        (err: unknown) => codeOf(err) === "validation_failed",
      );
      await assert.rejects(
        () => handleRefund(key, BOUNTY, { funderAddress: ATTACKER }, "refund-addr", bag.deps),
        (err: unknown) => codeOf(err) === "validation_failed",
      );
    } finally {
      console.log = original;
    }
    assert.equal(bag.calls.claim, 0);
    assert.equal(bag.calls.refund, 0);
    assert.equal(lines.some((line) => line.includes(ATTACKER)), false);

    const { token } = await principal(bag.deps);
    const claimDenied = await handleV1Action(
      new Request("https://dev.githubbounties.xyz/api/v1/bounties/" + BOUNTY + "/claim", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "claim-http-addr",
        },
        body: JSON.stringify({ kind: "winner", payoutAddress: ATTACKER }),
      }),
      { kind: "claim", bountyId: BOUNTY },
      bag.deps,
    );
    assert.equal(claimDenied.status, 400);
    assert.equal(claimDenied.headers.get("ratelimit-limit"), "10");
    assert.equal(claimDenied.headers.get("ratelimit-reset"), "3600");
    const refundDenied = await handleV1Action(
      new Request("https://dev.githubbounties.xyz/api/v1/bounties/" + BOUNTY + "/refund", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "refund-http-addr",
        },
        body: JSON.stringify({ destination: ATTACKER }),
      }),
      { kind: "refund", bountyId: BOUNTY },
      bag.deps,
    );
    assert.equal(refundDenied.status, 400);
    assert.equal(refundDenied.headers.get("ratelimit-limit"), "10");
    assert.equal(refundDenied.headers.get("ratelimit-reset"), "3600");

    const { token: readToken } = await principal(bag.deps, ["read"]);
    const mcpClaim = await handleMcpHttp(
      new Request("https://dev.githubbounties.xyz/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${readToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "claim_winner",
            arguments: { id: BOUNTY, idempotencyKey: "claim-mcp-scope" },
          },
        }),
      }),
      bag.deps,
    );
    assert.equal(mcpClaim.status, 200);
    assert.equal(mcpClaim.headers.get("ratelimit-limit"), "10");
    assert.equal(mcpClaim.headers.get("ratelimit-reset"), "3600");
    const mcpText = await mcpClaim.text();
    assert.match(mcpText, /forbidden_scope/);
    assert.equal(bag.calls.claim, 0);
  });

  it("requires money scope and a linked GitHub account", async () => {
    const reader = memory();
    const { principal: readKey } = await principal(reader.deps, ["read"]);
    await assert.rejects(
      () => handleClaim(readKey, BOUNTY, { kind: "winner" }, "claim-scope", reader.deps),
      (err: unknown) => codeOf(err) === "forbidden_scope",
    );
    assert.equal(reader.calls.claim, 0);

    const unlinked = memory({ github: false });
    const { principal: payer } = await principal(unlinked.deps, ["read", "write"]);
    payer.scopes.add("money");
    await assert.rejects(
      () => handleClaim(payer, BOUNTY, { kind: "winner" }, "claim-gh", unlinked.deps),
      (err: unknown) => codeOf(err) === "github_not_linked",
    );
    assert.equal(unlinked.calls.claim, 0);
  });

  it("returns 403 not_winner when the linked login is not the merged PR author", async () => {
    const bag = memory();
    const { principal: mallory } = await principal(bag.deps, ["read", "write", "money"], undefined, MALLORY);
    await assert.rejects(
      () => handleClaim(mallory, BOUNTY, { kind: "winner" }, "claim-mallory", bag.deps),
      (err: unknown) => codeOf(err) === "not_winner",
    );
    assert.equal(bag.calls.claim, 0);
  });

  it("replays a winner claim without paying twice and logs the saved wallet", async () => {
    const bag = memory();
    const { principal: key } = await principal(bag.deps);
    const lines: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      const first = await handleClaim(key, BOUNTY, { kind: "winner" }, "claim-1", bag.deps);
      const second = await handleClaim(key, BOUNTY, { kind: "winner" }, "claim-1", bag.deps);
      assert.equal(first.status, 200);
      assert.deepEqual(second.body, first.body);
      const body = first.body as { destination?: string; txHash?: string; kind?: string };
      assert.equal(body.destination, PAYER);
      assert.equal(body.kind, "winner");
      assert.equal(body.txHash, TX);
    } finally {
      console.log = original;
    }
    assert.equal(bag.calls.claim, 1);
    const paid = lines
      .map((line) => JSON.parse(line) as { event?: string; result?: string; destination?: string; apiKeyId?: string; leg?: string })
      .filter((row) => row.event === "money_action" && row.result === "ok");
    assert.equal(paid.length, 1);
    assert.equal(paid[0]?.destination, PAYER);
    assert.equal(paid[0]?.leg, "WINNER_PAYOUT");
    assert.equal(paid[0]?.apiKeyId, key.keyId);
  });

  it("lets a pool member claim only their own share", async () => {
    const bag = memory();
    const { principal: alice } = await principal(bag.deps);
    const { principal: bob } = await principal(bag.deps, ["read", "write", "money"], undefined, BOB);
    await handleClaim(alice, BOUNTY, { kind: "pool" }, "pool-alice", bag.deps);
    assert.equal(bag.poolPaid.has(USER), true);
    assert.equal(bag.poolPaid.has(BOB), false);
    await handleClaim(bob, BOUNTY, { kind: "pool" }, "pool-bob", bag.deps);
    assert.equal(bag.poolPaid.has(BOB), true);
    assert.equal(bag.calls.claim, 2);
    const { principal: mallory } = await principal(bag.deps, ["read", "write", "money"], undefined, MALLORY);
    await assert.rejects(
      () => handleClaim(mallory, BOUNTY, { kind: "pool" }, "mallory-pool", bag.deps),
      (err: unknown) => codeOf(err) === "not_pool_member",
    );
    assert.equal(bag.calls.claim, 2);
    await assert.rejects(
      () => handleClaim(bob, BOUNTY, { kind: "winner" }, "bob-winner", bag.deps),
      (err: unknown) => codeOf(err) === "not_winner",
    );
    assert.equal(bag.calls.claim, 2);
  });

  it("refuses claim and refund on mainnet config", async () => {
    const bag = memory({ env: envFor("base"), status: "funded" });
    const { principal: key } = await principal(bag.deps);
    await assert.rejects(
      () => handleClaim(key, BOUNTY, { kind: "winner" }, "claim-mainnet", bag.deps),
      (err: unknown) => codeOf(err) === "forbidden_scope",
    );
    await assert.rejects(
      () => handleRefund(key, BOUNTY, {}, "refund-mainnet", bag.deps),
      (err: unknown) => codeOf(err) === "forbidden_scope",
    );
    assert.equal(bag.calls.claim, 0);
    assert.equal(bag.calls.refund, 0);
  });

  it("refunds only through the recorded payer and replays without a second call", async () => {
    const bag = memory({ status: "funded" });
    const { principal: key } = await principal(bag.deps);
    const first = await handleRefund(key, BOUNTY, {}, "refund-1", bag.deps);
    const second = await handleRefund(key, BOUNTY, {}, "refund-1", bag.deps);
    assert.equal(bag.calls.refund, 1);
    assert.deepEqual(second.body, first.body);
    const body = first.body as {
      destination?: string;
      refundTxHash?: string;
      legs?: { destination: string; amount: string; status: string; txHash: string }[];
    };
    assert.equal(body.destination, RECORDED_PAYER);
    assert.equal(body.refundTxHash, TX);
    assert.equal(body.legs?.length, 1);
    assert.equal(body.legs?.[0]?.destination, RECORDED_PAYER);
    assert.equal(body.legs?.[0]?.status, "paid");
    assert.equal(body.legs?.[0]?.txHash, TX);
    assert.notEqual(body.destination, ATTACKER);

    const stranger = memory({ status: "funded", poster: MALLORY });
    const { principal: other } = await principal(stranger.deps);
    await assert.rejects(
      () => handleRefund(other, BOUNTY, {}, "refund-stranger", stranger.deps),
      (err: unknown) => codeOf(err) === "not_poster",
    );
    assert.equal(stranger.calls.refund, 0);
  });

  it("lists only the caller's claim legs", async () => {
    const bag = memory();
    const { principal: key } = await principal(bag.deps, ["read"]);
    const mine = await handleMyClaims(key, bag.deps);
    const one = await handleBountyClaims(key, BOUNTY, bag.deps);
    assert.equal((mine.body as { claims: { kind: string; txHash: string; destination: string }[] }).claims[0]?.kind, "winner");
    assert.equal((one.body as { legs: { txHash: string; destination: string }[] }).legs[0]?.txHash, TX);
    assert.equal((mine.body as { claims: { destination: string }[] }).claims[0]?.destination, PAYER);
    assert.equal((one.body as { legs: { destination: string }[] }).legs[0]?.destination, PAYER);
    const json = JSON.stringify(mine.body) + JSON.stringify(one.body);
    assert.equal(json.includes(ATTACKER), false);
    assert.equal(json.includes("wallet"), false);
  });

  it("keeps the shown-once secret out of form restore and browser storage", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const card = readFileSync(join(root, "../../components/api-keys-card.tsx"), "utf8");
    assert.doesNotMatch(card, /useActionState/);
    assert.doesNotMatch(card, /localStorage|sessionStorage/);
    assert.match(card, /pagehide/);
    assert.match(card, /pageshow/);
    assert.match(card, /onSubmit/);
    assert.doesNotMatch(card, /action=\{onCreate\}/);
    assert.match(card, /autoComplete="off"/);
    assert.match(card, /Dismiss/);
    assert.match(card, /refresh\(\)/);
    assert.match(card, /Confirm revoke/);
    assert.match(card, /Created \{key\.createdAt\}/);
    assert.match(card, /Last used/);
    const config = readFileSync(join(root, "../../../next.config.ts"), "utf8");
    assert.match(config, /\/settings/);
    assert.match(config, /no-store/);
  });
});
