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
import type { AccessDeps, ApiKeyRecord } from "./deps";
import {
  authenticateBearer,
  createApiKey,
  handleCancel,
  handleCreateBounty,
  handleFund,
  handleMe,
  handleTopUp,
  revokeApiKey,
  runAuthed,
  type ApiPrincipal,
} from "./handlers";
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
const BOUNTY = "00000000-0000-4000-8000-000000000022";
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
}) {
  const keys: ApiKeyRecord[] = [];
  const logs: { id: string; keyId: string; route: string; status: number; createdAt: Date }[] = [];
  const spends: { id: string; keyId: string; amountUsdc: string; status: string; createdAt: Date; kind: string }[] = [];
  const idem = new Map<string, IdempotencyRow>();
  const calls = { lock: 0, topUp: 0, seller: 0, inbound: 0, cancel: 0, create: 0 };
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
    async insertSpend(row) {
      const id = randomUUID();
      spends.push({
        id,
        keyId: row.keyId,
        amountUsdc: row.amountUsdc,
        status: row.status,
        createdAt: row.createdAt,
        kind: row.kind,
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
  };
  return { deps, keys, calls, spends, setOpenSpend: (usdc: string) => { openSpend = usdcToAtomic(usdc); } };
}

async function principal(
  deps: AccessDeps,
  scopes: ApiKeyScope[] = ["read", "write", "money"],
  caps?: { perTx?: string; daily?: string },
): Promise<{ token: string; principal: ApiPrincipal }> {
  const created = await createApiKey(
    {
      userId: USER,
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
  });
});
