import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { createBountyFromIssueUrl } from "../../bounties/create";
import { clearWorkSignal, signalWorkingOnThis } from "../../bounties/signals";
import type { Database } from "../../db/client";
import {
  apiIdempotencyKeys,
  apiKeys,
  apiRequestLog,
  apiSpendLedger,
  bounties,
  bountyContributions,
  githubLinks,
  users,
  type ApiKeyEnv,
  type ApiKeyScope,
} from "../../db/schema";
import { lockEscrowFunds, refundEscrow } from "../../escrow/service";
import { recordExactInbound } from "../../escrow/inbound";
import { resolveRail } from "../../escrow/rail";
import { assertFundedTopUpOpen, topUpFundedBounty } from "../../escrow/top-up";
import { processLiveX402Exact } from "../../escrow/x402-seller";
import { atomicToUsdc, usdcToAtomic } from "../../lib/money";
import type { AccessDeps, ApiKeyRecord } from "./deps";
import type { IdempotencyRow } from "./policy";

function asKey(row: typeof apiKeys.$inferSelect): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    env: row.env as ApiKeyEnv,
    prefix: row.prefix,
    keyHash: row.keyHash,
    scopes: (row.scopes ?? []).filter((scope): scope is ApiKeyScope =>
      scope === "read" || scope === "write" || scope === "money",
    ),
    perTxCapUsdc: row.perTxCapUsdc,
    dailyCapUsdc: row.dailyCapUsdc,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    lastUsedIp: row.lastUsedIp,
    revokedAt: row.revokedAt,
    expiresAt: row.expiresAt,
  };
}

export function createAccessDeps(
  db: Database,
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): AccessDeps {
  return {
    env,
    now,
    async findKeyByHash(keyHash) {
      const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
      return row ? asKey(row) : null;
    },
    async insertKey(row) {
      await db.insert(apiKeys).values({
        id: row.id,
        userId: row.userId,
        name: row.name,
        env: row.env,
        prefix: row.prefix,
        keyHash: row.keyHash,
        scopes: [...row.scopes],
        perTxCapUsdc: row.perTxCapUsdc,
        dailyCapUsdc: row.dailyCapUsdc,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        lastUsedIp: row.lastUsedIp,
        revokedAt: row.revokedAt,
        expiresAt: row.expiresAt,
      });
    },
    async listKeys(userId) {
      const rows = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.userId, userId))
        .orderBy(desc(apiKeys.createdAt));
      return rows.map(asKey);
    },
    async revokeKey(userId, keyId, at) {
      const [row] = await db
        .update(apiKeys)
        .set({ revokedAt: at })
        .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
        .returning({ id: apiKeys.id });
      return Boolean(row);
    },
    async touchKey(keyId, at, ip) {
      await db
        .update(apiKeys)
        .set({ lastUsedAt: at, lastUsedIp: ip })
        .where(eq(apiKeys.id, keyId));
    },
    async insertRequest(row) {
      const [inserted] = await db
        .insert(apiRequestLog)
        .values({
          keyId: row.keyId,
          userId: row.userId,
          route: row.route,
          status: row.status,
          bountyId: row.bountyId,
          ip: row.ip,
          createdAt: row.createdAt,
        })
        .returning({ id: apiRequestLog.id });
      if (!inserted) throw new Error("insert api_request_log returned no row");
      return inserted.id;
    },
    async updateRequestStatus(id, status) {
      await db.update(apiRequestLog).set({ status }).where(eq(apiRequestLog.id, id));
    },
    async countRequests(keyId, routePrefix, since) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(apiRequestLog)
        .where(
          and(
            eq(apiRequestLog.keyId, keyId),
            gte(apiRequestLog.createdAt, since),
            sql`${apiRequestLog.route} like ${`${routePrefix}%`}`,
          ),
        );
      return Number(row?.n ?? 0);
    },
    async sumOpenSpend(keyId, since) {
      const [row] = await db
        .select({
          total: sql<string>`coalesce(sum(${apiSpendLedger.amountUsdc}), 0)::numeric(20,6)::text`,
        })
        .from(apiSpendLedger)
        .where(
          and(
            eq(apiSpendLedger.keyId, keyId),
            gte(apiSpendLedger.createdAt, since),
            inArray(apiSpendLedger.status, ["reserved", "recorded"]),
          ),
        );
      const total = row?.total ?? "0";
      return atomicToUsdc(usdcToAtomic(total));
    },
    async insertSpend(row) {
      const [inserted] = await db
        .insert(apiSpendLedger)
        .values({
          keyId: row.keyId,
          bountyId: row.bountyId,
          kind: row.kind,
          amountUsdc: row.amountUsdc,
          txHash: row.txHash,
          status: row.status,
          createdAt: row.createdAt,
        })
        .returning({ id: apiSpendLedger.id });
      if (!inserted) throw new Error("insert api_spend_ledger returned no row");
      return inserted.id;
    },
    async updateSpend(id, patch) {
      await db
        .update(apiSpendLedger)
        .set({
          status: patch.status,
          ...(patch.txHash !== undefined ? { txHash: patch.txHash } : {}),
        })
        .where(eq(apiSpendLedger.id, id));
    },
    async findIdempotency(keyId, idempotencyKey) {
      const [row] = await db
        .select()
        .from(apiIdempotencyKeys)
        .where(and(eq(apiIdempotencyKeys.keyId, keyId), eq(apiIdempotencyKeys.idempotencyKey, idempotencyKey)))
        .limit(1);
      if (!row) return null;
      return {
        keyId: row.keyId,
        idempotencyKey: row.idempotencyKey,
        requestHash: row.requestHash,
        responseStatus: row.responseStatus,
        responseBody: row.responseBody,
        responseHeaders: row.responseHeaders,
        expiresAt: row.expiresAt,
      } satisfies IdempotencyRow;
    },
    async saveIdempotency(row) {
      await db
        .insert(apiIdempotencyKeys)
        .values({
          keyId: row.keyId,
          idempotencyKey: row.idempotencyKey,
          requestHash: row.requestHash,
          responseStatus: row.responseStatus,
          responseBody: row.responseBody,
          responseHeaders: row.responseHeaders,
          expiresAt: row.expiresAt,
        })
        .onConflictDoUpdate({
          target: [apiIdempotencyKeys.keyId, apiIdempotencyKeys.idempotencyKey],
          set: {
            requestHash: row.requestHash,
            responseStatus: row.responseStatus,
            responseBody: row.responseBody,
            responseHeaders: row.responseHeaders,
            expiresAt: row.expiresAt,
          },
        });
    },
    async moneyGate(userId) {
      const [user] = await db
        .select({ walletAddress: users.walletAddress })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const [link] = await db
        .select({ githubLogin: githubLinks.githubLogin })
        .from(githubLinks)
        .where(eq(githubLinks.userId, userId))
        .limit(1);
      return {
        wallet: Boolean(user?.walletAddress?.trim()),
        github: Boolean(link?.githubLogin?.trim()),
      };
    },
    async loadMe(userId) {
      const [row] = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          email: users.email,
          walletAddress: users.walletAddress,
          githubLogin: githubLinks.githubLogin,
        })
        .from(users)
        .leftJoin(githubLinks, eq(githubLinks.userId, users.id))
        .where(eq(users.id, userId))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        displayName: row.displayName,
        email: row.email,
        walletAddress: row.walletAddress,
        githubLogin: row.githubLogin,
      };
    },
    async listMyBounties(userId) {
      const posted = await db
        .select({
          id: bounties.id,
          title: bounties.title,
          status: bounties.status,
          amountUsdc: bounties.amountUsdc,
          issueUrl: bounties.url,
          createdAt: bounties.createdAt,
          fundedAt: bounties.fundedAt,
        })
        .from(bounties)
        .where(eq(bounties.posterUserId, userId))
        .orderBy(desc(bounties.createdAt))
        .limit(50);
      const funded = await db
        .select({
          bountyId: bounties.id,
          title: bounties.title,
          status: bounties.status,
          amountUsdc: bounties.amountUsdc,
          contributionUsdc: bountyContributions.amountUsdc,
          txHash: bountyContributions.fundTxHash,
          createdAt: bountyContributions.createdAt,
        })
        .from(bountyContributions)
        .innerJoin(bounties, eq(bounties.id, bountyContributions.bountyId))
        .where(eq(bountyContributions.funderUserId, userId))
        .orderBy(desc(bountyContributions.createdAt))
        .limit(50);
      return { posted, funded };
    },
    async loadMoneyBounty(bountyId) {
      const [row] = await db
        .select({
          id: bounties.id,
          posterUserId: bounties.posterUserId,
          status: bounties.status,
          amountUsdc: bounties.amountUsdc,
          title: bounties.title,
          issueUrl: bounties.url,
        })
        .from(bounties)
        .where(eq(bounties.id, bountyId))
        .limit(1);
      return row ?? null;
    },
    async assertTopUpOpen(bountyId) {
      await assertFundedTopUpOpen(db, bountyId);
    },
    async escrowPayTo() {
      const rail = resolveRail(env);
      const wallets = await rail.ensureWallets();
      return { payTo: wallets.escrowAddress, network: rail.network, mode: rail.mode };
    },
    async liveSeller(input) {
      const req = new Request(input.resourceUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "PAYMENT-SIGNATURE": input.paymentSignature,
        },
      });
      return processLiveX402Exact({
        req,
        bountyId: input.bountyId,
        faceUsdc: input.amountUsdc,
        payTo: input.payTo,
        network: input.network,
        paymentHeader: input.paymentSignature,
        env,
        description: input.description,
      });
    },
    async recordInbound(input) {
      await recordExactInbound(db, {
        bountyId: input.bountyId,
        txHash: input.txHash,
        x402PaymentId: input.txHash.startsWith("0x") ? `x402:${input.txHash}` : input.txHash,
        escrowAddress: input.payTo,
        resourceUrl: input.resourceUrl,
        funderAddress: input.payer,
        now: now(),
      });
    },
    async lockFunds(input) {
      const locked = await lockEscrowFunds(input.bountyId, input.actorUserId, {
        db,
        fundTxHash: input.fundTxHash,
        requestId: input.requestId,
        now: now(),
      });
      return { fundTxHash: locked.fundTxHash, status: locked.status };
    },
    async topUp(input) {
      const applied = await topUpFundedBounty(
        input.bountyId,
        input.actorUserId,
        {
          amountUsdc: input.amountUsdc,
          fundTxHash: input.fundTxHash,
          funderAddress: input.payer,
        },
        { db, fundHashSource: "x402", requestId: input.requestId, now: now() },
      );
      return {
        fundTxHash: applied.fundTxHash,
        faceUsdc: applied.faceUsdc,
        amountUsdc: applied.amountUsdc,
      };
    },
    async createBounty(input) {
      return createBountyFromIssueUrl(input, { db });
    },
    async signalWorking(bountyId, userId) {
      const signal = await signalWorkingOnThis(bountyId, userId, db, now());
      return { id: signal.id, bountyId: signal.bountyId, signaledAt: signal.signaledAt };
    },
    async clearSignal(bountyId, userId) {
      return clearWorkSignal(bountyId, userId, db, now());
    },
    async cancelUnfunded(bountyId, actorUserId, requestId) {
      const result = await refundEscrow(
        bountyId,
        { actorUserId, reason: "cancel" },
        { db, requestId, now: now() },
      );
      return { status: result.bountyStatus, refundTxHash: result.refundTxHash };
    },
  };
}
