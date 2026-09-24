import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { normalizeBountyAmountUsdc } from "../bounties/amount";
import { resolveFunderAvatarUrl } from "../bounties/funders";
import type { Database } from "../db/client";
import {
  bounties,
  bountyContributions,
  claims,
  escrows,
  githubLinks,
  poolParticipants,
  users,
} from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import { atomicToUsdc, usdcToAtomic } from "../lib/money";
import { EscrowError } from "./errors";
import { assertFundTxHashAvailable } from "./fund-hash";
import { requireBasePayoutAddress } from "./payout-address";
import { withVerifiedTopUpHash } from "./payout-guard";
import { resolveRail, type CdpRail } from "./rail";

export type TopUpOpts = {
  db: Database;
  rail?: CdpRail;
  now?: Date;
  /**
   * `x402` is server-only, set by the x402 handler after facilitator settle.
   * HTTP routes and server actions stay `caller` and cannot paste a live hash.
   */
  fundHashSource?: "caller" | "x402";
};

export type TopUpResult = {
  bountyId: string;
  contributionId: string;
  amountUsdc: string;
  faceUsdc: string;
  fundTxHash: string;
  alreadyApplied: boolean;
  funderUserId: string;
  status: "funded";
};

export type BountyContributionView = {
  id: string;
  funderUserId: string;
  displayName: string;
  amountUsdc: string;
  funderAddress: string | null;
  fundTxHash: string;
  createdAt: Date;
  /**
   * https picture for this contribution's funder.
   * Same resolution as board faces: Google `users.avatar_url`, then GitHub.
   * Null means the row should show initials. Repeat top-ups keep their own row.
   */
  avatarUrl: string | null;
};

export type ContributionRefundLeg = {
  contributionId: string;
  amountUsdc: string;
  amountAtomic: bigint;
  toAddress: string;
  idempotencyKey: string;
  refundTxHash: string | null;
};

function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export function topUpIdempotencyKey(bountyId: string, fundTxHash: string): string {
  return deterministicUuid(`gb-top-up:${bountyId}:${fundTxHash}`);
}

export function contributionRefundKey(bountyId: string, contributionId: string): string {
  return deterministicUuid(`gb-v1-5:${bountyId}:REFUND_OUT:${contributionId}`);
}

/**
 * First Lock credits the poster. Later top-ups add rows; face stays the sum.
 * Retries of the same fund hash do not increase face again.
 */
export async function recordLockContribution(
  db: Database,
  input: {
    bountyId: string;
    funderUserId: string;
    amountUsdc: string;
    fundTxHash: string;
    funderAddress: string | null;
    now: Date;
  },
): Promise<void> {
  const fundTxHash = input.fundTxHash.trim() || `lock:${input.bountyId}`;
  await assertFundTxHashAvailable(db, fundTxHash, input.bountyId);
  const existing = await findContributionByHash(db, input.bountyId, fundTxHash);
  if (existing) return;
  try {
    await insertContribution(db, {
      bountyId: input.bountyId,
      funderUserId: input.funderUserId,
      amountUsdc: input.amountUsdc,
      fundTxHash,
      funderAddress: input.funderAddress,
      now: input.now,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new EscrowError(
        "fund_hash_reused",
        "This fund transaction hash is already recorded on another bounty.",
      );
    }
    throw err;
  }
}

async function insertContribution(
  db: Database,
  input: {
    bountyId: string;
    funderUserId: string;
    amountUsdc: string;
    fundTxHash: string;
    funderAddress: string | null;
    now: Date;
  },
): Promise<typeof bountyContributions.$inferSelect> {
  const [inserted] = await db.insert(bountyContributions).values({
    bountyId: input.bountyId,
    funderUserId: input.funderUserId,
    amountUsdc: input.amountUsdc,
    fundTxHash: input.fundTxHash,
    funderAddress: input.funderAddress,
    createdAt: input.now,
    updatedAt: input.now,
  }).returning();
  if (!inserted) {
    throw new EscrowError("not_fundable", "Could not record the fund contribution.");
  }
  return inserted;
}

export async function listBountyContributions(
  bountyId: string,
  db: Database,
): Promise<BountyContributionView[]> {
  const rows = await db
    .select({
      id: bountyContributions.id,
      funderUserId: bountyContributions.funderUserId,
      displayName: users.displayName,
      amountUsdc: bountyContributions.amountUsdc,
      funderAddress: bountyContributions.funderAddress,
      fundTxHash: bountyContributions.fundTxHash,
      createdAt: bountyContributions.createdAt,
      userAvatarUrl: users.avatarUrl,
      githubAvatarUrl: githubLinks.githubAvatarUrl,
      githubLogin: githubLinks.githubLogin,
    })
    .from(bountyContributions)
    .innerJoin(users, eq(users.id, bountyContributions.funderUserId))
    .leftJoin(githubLinks, eq(githubLinks.userId, users.id))
    .where(eq(bountyContributions.bountyId, bountyId))
    .orderBy(asc(bountyContributions.createdAt), asc(bountyContributions.id));
  return rows.map((row) => ({
    id: row.id,
    funderUserId: row.funderUserId,
    displayName: row.displayName,
    amountUsdc: row.amountUsdc,
    funderAddress: row.funderAddress,
    fundTxHash: row.fundTxHash,
    createdAt: row.createdAt,
    avatarUrl: resolveFunderAvatarUrl({
      avatarUrl: row.userAvatarUrl,
      githubAvatarUrl: row.githubAvatarUrl,
      githubLogin: row.githubLogin,
    }),
  }));
}

/**
 * Additional USDC is accepted only while the bounty is funded and the
 * winner / pool set is not frozen yet. Settlement still reads the face.
 */
export async function assertFundedTopUpOpen(
  db: Database,
  bountyId: string,
): Promise<{
  bounty: typeof bounties.$inferSelect;
  escrow: typeof escrows.$inferSelect;
}> {
  const [bounty] = await db.select().from(bounties).where(eq(bounties.id, bountyId)).limit(1);
  if (!bounty) {
    throw new EscrowError("bounty_not_found", "Bounty not found.");
  }
  if (bounty.status !== "funded") {
    throw new EscrowError(
      "not_fundable",
      `Bounty is ${bounty.status}. Additional USDC is only accepted while the bounty is funded.`,
    );
  }
  const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, bountyId)).limit(1);
  if (!escrow || escrow.status !== "funded") {
    throw new EscrowError(
      "not_fundable",
      "Escrow is not locked. Additional USDC is only accepted after the first Lock.",
    );
  }
  const [claim] = await db
    .select({ id: claims.id })
    .from(claims)
    .where(eq(claims.bountyId, bountyId))
    .limit(1);
  if (claim) {
    throw new EscrowError(
      "not_fundable",
      "This bounty already has a winner. Top-ups close at the winning merge.",
    );
  }
  const [frozen] = await db
    .select({ id: poolParticipants.id })
    .from(poolParticipants)
    .where(and(eq(poolParticipants.bountyId, bountyId), isNotNull(poolParticipants.frozenAt)))
    .limit(1);
  if (frozen) {
    throw new EscrowError(
      "not_fundable",
      "Pool shares are frozen. Top-ups close at the winning merge.",
    );
  }
  return { bounty, escrow };
}

/**
 * Add USDC to an already-funded bounty. Live rail accepts only the hash from
 * x402 settle for this top-up (`fundHashSource: "x402"`). Mock/local may paste
 * a hash. Increases face on the bounty and escrow. Does not change the 2% fee
 * or the post-fee pool split — both still run off the new face at Claim.
 */
export async function topUpFundedBounty(
  bountyId: string,
  actorUserId: string,
  input: { amountUsdc: string; fundTxHash?: string | null; funderAddress?: string | null },
  opts: TopUpOpts,
): Promise<TopUpResult> {
  if (!actorUserId) {
    throw new EscrowError("unauthorized", "Sign in with Google to add USDC to this bounty.");
  }
  const amountUsdc = normalizeBountyAmountUsdc(input.amountUsdc);
  const now = opts.now ?? new Date();
  await assertFundedTopUpOpen(opts.db, bountyId);

  const rail = opts.rail ?? resolveRail();
  const source = opts.fundHashSource ?? "caller";
  const pasted = input.fundTxHash?.trim() || "";
  if (rail.mode === "cdp" && source !== "x402") {
    throw new EscrowError(
      "fund_hash_not_verified",
      "Live rail top-up must go through x402 settle. Paste-hash top-up is mock/local only.",
    );
  }
  if (rail.mode === "cdp" && !pasted) {
    throw new EscrowError(
      "fund_hash_not_verified",
      "x402 top-up settle returned no transaction hash. Face was not increased.",
    );
  }
  if (pasted) {
    const prior = await findContributionByHash(opts.db, bountyId, pasted);
    if (prior) {
      const [bounty] = await opts.db.select().from(bounties).where(eq(bounties.id, bountyId)).limit(1);
      return toResult(bountyId, prior, bounty?.amountUsdc ?? prior.amountUsdc, true);
    }
    await assertFundTxHashAvailable(opts.db, pasted, bountyId);
  }

  const locked = await rail.lockFace({
    amountAtomic: usdcToAtomic(amountUsdc),
    idempotencyKey: topUpIdempotencyKey(
      bountyId,
      pasted || `${actorUserId}:${amountUsdc}:${now.toISOString()}`,
    ),
    fundTxHash: pasted || null,
    verifiedInbound: rail.mode === "cdp" && source === "x402",
  });
  const fundTxHash = locked.txHash.trim();
  if (!fundTxHash) {
    throw new EscrowError("inbound_unconfirmed", "Top-up rail returned no fund transaction hash.");
  }
  await assertFundTxHashAvailable(opts.db, fundTxHash, bountyId);

  const [actor] = await opts.db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, actorUserId))
    .limit(1);
  const funderAddress = input.funderAddress?.trim() || actor?.walletAddress?.trim() || null;

  const applied = await opts.db.transaction(async (tx) => {
    const database = tx as unknown as Database;
    await database.execute(sql`select id from bounties where id = ${bountyId} for update`);
    const { bounty } = await assertFundedTopUpOpen(database, bountyId);
    const existing = await findContributionByHash(database, bountyId, fundTxHash);
    if (existing) {
      return { row: existing, faceUsdc: bounty.amountUsdc, alreadyApplied: true };
    }
    await backfillOriginalContribution(database, bounty, now);
    const afterBackfill = await findContributionByHash(database, bountyId, fundTxHash);
    if (afterBackfill) {
      return { row: afterBackfill, faceUsdc: bounty.amountUsdc, alreadyApplied: true };
    }
    let inserted: typeof bountyContributions.$inferSelect;
    try {
      inserted = await insertContribution(database, {
        bountyId,
        funderUserId: actorUserId,
        amountUsdc,
        fundTxHash,
        funderAddress,
        now,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new EscrowError(
          "fund_hash_reused",
          "This fund transaction hash is already recorded on another bounty.",
        );
      }
      throw err;
    }
    if (source === "x402") {
      const [escrowRow] = await database
        .select({ x402PaymentId: escrows.x402PaymentId })
        .from(escrows)
        .where(eq(escrows.bountyId, bountyId))
        .limit(1);
      await database
        .update(escrows)
        .set({
          x402PaymentId: withVerifiedTopUpHash(escrowRow?.x402PaymentId, fundTxHash),
          updatedAt: now,
        })
        .where(eq(escrows.bountyId, bountyId));
    }
    const faceUsdc = atomicToUsdc(usdcToAtomic(bounty.amountUsdc) + usdcToAtomic(amountUsdc));
    await database
      .update(bounties)
      .set({ amountUsdc: faceUsdc, updatedAt: now })
      .where(eq(bounties.id, bountyId));
    await database
      .update(escrows)
      .set({ amountUsdc: faceUsdc, updatedAt: now })
      .where(eq(escrows.bountyId, bountyId));
    return { row: inserted, faceUsdc, alreadyApplied: false };
  });

  return toResult(bountyId, applied.row, applied.faceUsdc, applied.alreadyApplied);
}

/**
 * N ≤ 1 keeps the existing single REFUND_OUT of full face.
 * N > 1 returns each contribution to that funder (still full face, no fee).
 */
export async function contributionRefundPlan(
  db: Database,
  bountyId: string,
  faceUsdc: string,
): Promise<{ kind: "single" } | { kind: "split"; legs: ContributionRefundLeg[] }> {
  const rows = await db
    .select({
      id: bountyContributions.id,
      amountUsdc: bountyContributions.amountUsdc,
      funderAddress: bountyContributions.funderAddress,
      refundTxHash: bountyContributions.refundTxHash,
      walletAddress: users.walletAddress,
    })
    .from(bountyContributions)
    .leftJoin(users, eq(users.id, bountyContributions.funderUserId))
    .where(eq(bountyContributions.bountyId, bountyId))
    .orderBy(asc(bountyContributions.createdAt), asc(bountyContributions.id));

  if (rows.length <= 1) return { kind: "single" };

  const faceAtomic = usdcToAtomic(faceUsdc);
  const sum = rows.reduce((acc, row) => acc + usdcToAtomic(row.amountUsdc), BigInt(0));
  if (sum !== faceAtomic) {
    throw new EscrowError(
      "not_refundable",
      "Contribution totals do not match the escrow face. Refusing a partial refund.",
    );
  }

  const legs: ContributionRefundLeg[] = rows.map((row) => {
    const raw = row.funderAddress?.trim() || row.walletAddress?.trim() || "";
    if (!raw) {
      throw new EscrowError(
        "missing_funder_address",
        "Each funder needs a wallet address before a multi-funder refund.",
      );
    }
    const toAddress = requireBasePayoutAddress(raw, "missing_funder_address");
    return {
      contributionId: row.id,
      amountUsdc: row.amountUsdc,
      amountAtomic: usdcToAtomic(row.amountUsdc),
      toAddress,
      idempotencyKey: contributionRefundKey(bountyId, row.id),
      refundTxHash: row.refundTxHash?.trim() || null,
    };
  });
  return { kind: "split", legs };
}

export async function markContributionRefunded(
  db: Database,
  contributionId: string,
  refundTxHash: string,
  now: Date,
): Promise<void> {
  await db
    .update(bountyContributions)
    .set({ refundTxHash, updatedAt: now })
    .where(eq(bountyContributions.id, contributionId));
}

async function findContributionByHash(db: Database, bountyId: string, fundTxHash: string) {
  const [row] = await db
    .select()
    .from(bountyContributions)
    .where(and(eq(bountyContributions.bountyId, bountyId), eq(bountyContributions.fundTxHash, fundTxHash)))
    .limit(1);
  return row ?? null;
}

async function backfillOriginalContribution(
  db: Database,
  bounty: typeof bounties.$inferSelect,
  now: Date,
): Promise<void> {
  const [any] = await db
    .select({ id: bountyContributions.id })
    .from(bountyContributions)
    .where(eq(bountyContributions.bountyId, bounty.id))
    .limit(1);
  if (any) return;
  const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, bounty.id)).limit(1);
  await db.insert(bountyContributions).values({
    bountyId: bounty.id,
    funderUserId: bounty.posterUserId,
    amountUsdc: bounty.amountUsdc,
    fundTxHash: escrow?.fundTxHash?.trim() || `legacy-fund:${bounty.id}`,
    funderAddress: escrow?.funderAddress ?? null,
    createdAt: bounty.fundedAt ?? now,
    updatedAt: now,
  });
}

function toResult(
  bountyId: string,
  row: typeof bountyContributions.$inferSelect,
  faceUsdc: string,
  alreadyApplied: boolean,
): TopUpResult {
  return {
    bountyId,
    contributionId: row.id,
    amountUsdc: row.amountUsdc,
    faceUsdc,
    fundTxHash: row.fundTxHash,
    alreadyApplied,
    funderUserId: row.funderUserId,
    status: "funded",
  };
}
