import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { createBountyFromIssueUrl } from "../../bounties/create";
import { clearWorkSignal, signalWorkingOnThis } from "../../bounties/signals";
import { claimPoolPayout, claimPayout } from "../../claims/payout";
import type { Database } from "../../db/client";
import {
  apiIdempotencyKeys,
  apiKeys,
  apiRequestLog,
  apiSpendLedger,
  bounties,
  bountyContributions,
  claims,
  escrows,
  githubLinks,
  poolParticipants,
  users,
  type ApiKeyEnv,
  type ApiKeyScope,
} from "../../db/schema";
import { lockEscrowFunds, refundEscrow } from "../../escrow/service";
import { recordExactInbound } from "../../escrow/inbound";
import { resolveRail, type CdpRail } from "../../escrow/rail";
import { assertFundedTopUpOpen, topUpFundedBounty } from "../../escrow/top-up";
import { processLiveX402Exact } from "../../escrow/x402-seller";
import { atomicToUsdc, usdcToAtomic } from "../../lib/money";
import {
  loadAccountProfile,
  loadEmailNotificationPreferences,
  loadLinkedAccounts,
  saveDisplayName,
  saveEmailNotificationPreferences,
} from "../../profile/settings";
import { PublicApiError } from "../public/errors";
import type { AccessDeps, ApiKeyRecord, ClaimLegView, PoolLegAuth, SpendRow, WinnerLegAuth } from "./deps";
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
  rail?: CdpRail,
): AccessDeps {
  const payoutRail = () => rail ?? resolveRail(env);
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
    async listRecentSpend(keyId, limit) {
      const cap = Math.min(Math.max(limit, 1), 50);
      const rows = await db
        .select()
        .from(apiSpendLedger)
        .where(
          and(
            eq(apiSpendLedger.keyId, keyId),
            inArray(apiSpendLedger.status, ["reserved", "recorded"]),
          ),
        )
        .orderBy(desc(apiSpendLedger.createdAt), desc(apiSpendLedger.id))
        .limit(cap);
      return rows.map((row) => ({
        id: row.id,
        keyId: row.keyId,
        bountyId: row.bountyId,
        kind: row.kind as SpendRow["kind"],
        amountUsdc: row.amountUsdc,
        txHash: row.txHash,
        status: row.status as SpendRow["status"],
        createdAt: row.createdAt,
      }));
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
    async loadAccountProfile(userId) {
      return loadAccountProfile(db, userId);
    },
    async saveDisplayName(userId, displayName) {
      return saveDisplayName(db, userId, displayName);
    },
    async loadEmailNotificationPreferences(userId) {
      return loadEmailNotificationPreferences(db, userId);
    },
    async saveEmailNotificationPreferences(userId, patch) {
      return saveEmailNotificationPreferences(db, userId, patch);
    },
    async loadLinkedAccounts(userId) {
      return loadLinkedAccounts(db, userId);
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
        actorUserId: input.actorUserId,
        moneyAction: input.moneyAction,
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
        {
          db,
          fundHashSource: "x402",
          requestId: input.requestId,
          now: now(),
          facilitatorSettlement: input.facilitatorSettlement,
        },
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
    async loadClaimAuthz(userId, bountyId, kind) {
      const bounty = await this.loadMoneyBounty(bountyId);
      const [user] = await db
        .select({ walletAddress: users.walletAddress })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const [link] = await db
        .select({ githubLogin: githubLinks.githubLogin, githubId: githubLinks.githubId })
        .from(githubLinks)
        .where(eq(githubLinks.userId, userId))
        .limit(1);
      const winner = bounty && kind === "winner" ? await loadWinnerLeg(db, bountyId) : null;
      const pool =
        bounty && kind === "pool" ? await loadOwnPoolLeg(db, bountyId, userId, link?.githubId ?? null) : null;
      return {
        bounty: bounty
          ? {
              id: bounty.id,
              title: bounty.title,
              status: bounty.status,
              amountUsdc: bounty.amountUsdc,
              posterUserId: bounty.posterUserId,
            }
          : null,
        walletAddress: user?.walletAddress ?? null,
        githubLogin: link?.githubLogin ?? null,
        winner,
        pool,
      };
    },
    async performClaim(input) {
      const wallet = await savedWallet(db, input.actorUserId);
      if (!wallet) {
        throw new PublicApiError("wallet_not_set", "Save a payout wallet before claiming with this key.", null, 403);
      }
      const railNow = payoutRail();
      if (input.kind === "winner") {
        const settled = await claimPayout(
          input.bountyId,
          input.actorUserId,
          { payoutAddress: wallet, persistWallet: false },
          { db, rail: railNow, requestId: input.requestId, now: now() },
        );
        return {
          bountyId: input.bountyId,
          kind: "winner" as const,
          status: settled.claimStatus,
          bountyStatus: settled.bountyStatus,
          amountUsdc: settled.winnerUsdc,
          txHash: settled.payoutTxHash,
          destination: wallet,
          claimId: settled.claimId,
          participantId: null,
        };
      }
      const settled = await claimPoolPayout(
        input.bountyId,
        input.actorUserId,
        { payoutAddress: wallet, persistWallet: false },
        { db, rail: railNow, requestId: input.requestId, now: now() },
      );
      const [member] = await db
        .select({
          txHash: poolParticipants.payoutTxHash,
          shareUsdc: poolParticipants.shareUsdc,
        })
        .from(poolParticipants)
        .where(eq(poolParticipants.id, settled.participantId))
        .limit(1);
      return {
        bountyId: input.bountyId,
        kind: "pool" as const,
        status: member?.txHash ? "paid" : "unpaid",
        bountyStatus: settled.bountyStatus,
        amountUsdc: member?.shareUsdc ?? settled.poolShareUsdc,
        txHash: member?.txHash ?? null,
        destination: wallet,
        claimId: null,
        participantId: settled.participantId,
      };
    },
    async performRefund(input) {
      const result = await refundEscrow(
        input.bountyId,
        { actorUserId: input.actorUserId, reason: "cancel" },
        { db, rail: payoutRail(), requestId: input.requestId, now: now() },
      );
      const [escrow] = await db
        .select({ funderAddress: escrows.funderAddress })
        .from(escrows)
        .where(eq(escrows.bountyId, input.bountyId))
        .limit(1);
      const [bounty] = await db
        .select({ amountUsdc: bounties.amountUsdc })
        .from(bounties)
        .where(eq(bounties.id, input.bountyId))
        .limit(1);
      return {
        bountyId: input.bountyId,
        status: result.bountyStatus,
        refundTxHash: result.refundTxHash,
        amountUsdc: bounty?.amountUsdc ?? "0.000000",
        destination: escrow?.funderAddress?.trim() || "",
      };
    },
    async listClaims(userId, bountyId) {
      if (bountyId) {
        const bounty = await this.loadMoneyBounty(bountyId);
        if (!bounty) throw new PublicApiError("not_found", "Bounty not found.");
      }
      const [link] = await db
        .select({ githubId: githubLinks.githubId })
        .from(githubLinks)
        .where(eq(githubLinks.userId, userId))
        .limit(1);
      const winnerRows = await db
        .select({
          bountyId: claims.bountyId,
          title: bounties.title,
          status: claims.status,
          amountUsdc: claims.payoutUsdc,
          txHash: claims.payoutTxHash,
          paidAt: claims.paidAt,
          createdAt: bounties.createdAt,
        })
        .from(claims)
        .innerJoin(bounties, eq(bounties.id, claims.bountyId))
        .where(
          and(eq(claims.hunterUserId, userId), bountyId ? eq(claims.bountyId, bountyId) : sql`true`),
        )
        .orderBy(desc(bounties.createdAt))
        .limit(50);
      const poolRows = await db
        .select({
          bountyId: poolParticipants.bountyId,
          title: bounties.title,
          shareUsdc: poolParticipants.shareUsdc,
          txHash: poolParticipants.payoutTxHash,
          paidAt: poolParticipants.paidAt,
          skipReason: poolParticipants.skipReason,
          createdAt: bounties.createdAt,
        })
        .from(poolParticipants)
        .innerJoin(bounties, eq(bounties.id, poolParticipants.bountyId))
        .where(
          and(
            eq(poolParticipants.role, "pool"),
            or(
              eq(poolParticipants.userId, userId),
              link ? eq(poolParticipants.githubId, link.githubId) : sql`false`,
            ),
            bountyId ? eq(poolParticipants.bountyId, bountyId) : sql`true`,
          ),
        )
        .orderBy(desc(bounties.createdAt))
        .limit(50);
      const legs: (ClaimLegView & { createdAt: Date })[] = [
        ...winnerRows.map((row) => ({
          bountyId: row.bountyId,
          title: row.title,
          kind: "winner" as const,
          status: row.status,
          amountUsdc: row.amountUsdc,
          txHash: row.txHash,
          paidAt: row.paidAt?.toISOString() ?? null,
          createdAt: row.createdAt,
        })),
        ...poolRows.map((row) => ({
          bountyId: row.bountyId,
          title: row.title,
          kind: "pool" as const,
          status: row.txHash ? "paid" : row.skipReason ? "skipped" : "unpaid",
          amountUsdc: row.shareUsdc,
          txHash: row.txHash,
          paidAt: row.paidAt?.toISOString() ?? null,
          createdAt: row.createdAt,
        })),
      ];
      legs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return legs.slice(0, 50).map(({ createdAt: _created, ...leg }) => leg);
    },
  };
}

async function savedWallet(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.walletAddress?.trim() || null;
}

async function loadWinnerLeg(db: Database, bountyId: string): Promise<WinnerLegAuth | null> {
  const rows = await db
    .select()
    .from(claims)
    .where(and(eq(claims.bountyId, bountyId), inArray(claims.status, ["eligible", "paid"])))
    .orderBy(desc(claims.updatedAt));
  const claim = rows.find((row) => row.status === "eligible") ?? rows.find((row) => row.status === "paid");
  if (!claim) return null;
  return {
    claimId: claim.id,
    hunterUserId: claim.hunterUserId,
    prAuthorLogin: claim.prAuthorLogin,
    status: claim.status,
    amountUsdc: claim.payoutUsdc,
    txHash: claim.payoutTxHash,
    paidAt: claim.paidAt,
  };
}

async function loadOwnPoolLeg(
  db: Database,
  bountyId: string,
  userId: string,
  githubId: bigint | null,
): Promise<PoolLegAuth | null> {
  const rows = await db
    .select()
    .from(poolParticipants)
    .where(
      and(
        eq(poolParticipants.bountyId, bountyId),
        eq(poolParticipants.role, "pool"),
        or(eq(poolParticipants.userId, userId), githubId != null ? eq(poolParticipants.githubId, githubId) : sql`false`),
      ),
    );
  const mine =
    rows.find((row) => row.userId === userId) ??
    rows.find((row) => githubId != null && row.githubId === githubId);
  if (!mine) return null;
  return {
    participantId: mine.id,
    userId: mine.userId,
    githubLogin: mine.githubLogin,
    shareUsdc: mine.shareUsdc,
    txHash: mine.payoutTxHash,
    paidAt: mine.paidAt,
  };
}
