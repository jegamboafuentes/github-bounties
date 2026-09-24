import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, claims, githubLinks, poolParticipants, repos, users } from "../db/schema";
import type { DomainEmailDeps } from "../email/events";
import { isEscrowError, settleEscrow, type SettleResult } from "../escrow";
import { loadFrozenSettleSet } from "../escrow/allocation";
import type { CdpRail } from "../escrow/rail";
import { INVALID_BASE_ADDRESS_MESSAGE, normalizeBaseAddress } from "../lib/address";
import { splitFaceUsdc } from "../lib/money";
import {
  ClaimError,
  NOT_ELIGIBLE_MESSAGE,
  NOT_HUNTER_MESSAGE,
  NOT_POOL_MEMBER_MESSAGE,
  POOL_NOT_READY_MESSAGE,
} from "./errors";
import { getPendingHunterLinkForBounty, pendingHunterLinkGuidance } from "./pending-link";

export type ClaimPayoutInput = {
  payoutAddress: string;
  persistWallet?: boolean;
  claimId?: string;
};

export type ClaimPayoutResult = SettleResult & {
  claimId: string;
  claimStatus: "paid" | "eligible" | string;
  faceUsdc: string;
  feePercent: number;
};

export type ClaimPoolPayoutInput = {
  payoutAddress: string;
  persistWallet?: boolean;
  participantId?: string;
};

export type ClaimPoolPayoutResult = SettleResult & {
  participantId: string;
  poolShareUsdc: string;
  faceUsdc: string;
  feePercent: number;
};

export type ClaimPayoutOpts = {
  db: Database;
  rail?: CdpRail;
  now?: Date;
  /** Optional. Production uses process.env. A missing Resend key does not fail Claim. */
  email?: DomainEmailDeps;
  requestId?: string | null;
};

/**
 * Hunter-only payout. Validates a BYO Base address, persists it on User/Claim,
 * then releases via V1-5 `settleEscrow` (no second money rail).
 */
export async function claimPayout(
  bountyId: string,
  actorUserId: string,
  input: ClaimPayoutInput,
  opts: ClaimPayoutOpts,
): Promise<ClaimPayoutResult> {
  if (!actorUserId) {
    throw new ClaimError("unauthorized", "Sign in with Google to claim a payout.");
  }

  const [bounty] = await opts.db
    .select()
    .from(bounties)
    .where(eq(bounties.id, bountyId))
    .limit(1);
  if (!bounty) {
    throw new ClaimError("bounty_not_found", "Bounty not found.");
  }

  const claim = await loadClaimForPayout(opts.db, bountyId, input.claimId, bounty);
  if (claim.hunterUserId !== actorUserId) {
    throw new ClaimError("not_hunter", NOT_HUNTER_MESSAGE);
  }

  let address: string;
  try {
    address = normalizeBaseAddress(input.payoutAddress);
  } catch {
    throw new ClaimError("invalid_payout_address", INVALID_BASE_ADDRESS_MESSAGE);
  }

  const persistWallet = input.persistWallet !== false;
  if (persistWallet) {
    await opts.db
      .update(users)
      .set({ walletAddress: address, updatedAt: opts.now ?? new Date() })
      .where(eq(users.id, actorUserId));
  }
  await opts.db
    .update(claims)
    .set({ payoutAddress: address, updatedAt: opts.now ?? new Date() })
    .where(eq(claims.id, claim.id));

  let settled: SettleResult;
  try {
    settled = await settleEscrow(
      bountyId,
      {
        actorUserId,
        claimId: claim.id,
        scope: "winner_and_fee",
      },
      opts,
    );
  } catch (err) {
    if (isEscrowError(err) && err.code === "not_settler") {
      throw new ClaimError("not_hunter", NOT_HUNTER_MESSAGE);
    }
    throw err;
  }

  const [paid] = await opts.db
    .select({ id: claims.id, status: claims.status })
    .from(claims)
    .where(eq(claims.id, claim.id))
    .limit(1);

  const split = splitFaceUsdc(bounty.amountUsdc);
  return {
    ...settled,
    claimId: claim.id,
    claimStatus: paid?.status ?? settled.bountyStatus,
    faceUsdc: split.faceUsdc,
    feePercent: split.feeBps / 100,
  };
}

/**
 * Frozen pool member Claims their own equal share. Wallet is required here,
 * not at winner Claim. Winner + fee must already be confirmed.
 */
export async function claimPoolPayout(
  bountyId: string,
  actorUserId: string,
  input: ClaimPoolPayoutInput,
  opts: ClaimPayoutOpts,
): Promise<ClaimPoolPayoutResult> {
  if (!actorUserId) {
    throw new ClaimError("unauthorized", "Sign in with Google to claim a pool share.");
  }

  const [bounty] = await opts.db
    .select()
    .from(bounties)
    .where(eq(bounties.id, bountyId))
    .limit(1);
  if (!bounty) {
    throw new ClaimError("bounty_not_found", "Bounty not found.");
  }

  const freeze = await loadFrozenSettleSet(opts.db, bountyId);
  const member = await resolvePoolMemberForActor(opts.db, freeze, actorUserId, input.participantId);

  let address: string;
  try {
    address = normalizeBaseAddress(input.payoutAddress);
  } catch {
    throw new ClaimError("invalid_payout_address", INVALID_BASE_ADDRESS_MESSAGE);
  }

  const persistWallet = input.persistWallet !== false;
  const now = opts.now ?? new Date();
  if (persistWallet) {
    await opts.db
      .update(users)
      .set({ walletAddress: address, updatedAt: now })
      .where(eq(users.id, actorUserId));
  }
  await opts.db
    .update(poolParticipants)
    .set({
      payoutAddress: address,
      userId: member.userId ?? actorUserId,
      skipReason: null,
      updatedAt: now,
    })
    .where(eq(poolParticipants.id, member.id));

  let settled: SettleResult;
  try {
    settled = await settleEscrow(
      bountyId,
      {
        actorUserId,
        participantId: member.id,
        scope: "pool_member",
      },
      opts,
    );
  } catch (err) {
    if (isEscrowError(err)) {
      if (err.code === "not_pool_member" || err.code === "not_settler") {
        throw new ClaimError("not_pool_member", NOT_POOL_MEMBER_MESSAGE);
      }
      if (err.code === "not_settleable" && /winner must claim first/i.test(err.message)) {
        throw new ClaimError("pool_not_ready", POOL_NOT_READY_MESSAGE);
      }
      if (err.code === "missing_payout_address") {
        throw new ClaimError("invalid_payout_address", err.message);
      }
    }
    throw err;
  }

  const split = splitFaceUsdc(bounty.amountUsdc);
  return {
    ...settled,
    participantId: member.id,
    poolShareUsdc: member.shareUsdc,
    faceUsdc: split.faceUsdc,
    feePercent: split.feeBps / 100,
  };
}

async function resolvePoolMemberForActor(
  db: Database,
  freeze: Awaited<ReturnType<typeof loadFrozenSettleSet>>,
  actorUserId: string,
  participantId?: string,
) {
  const [link] = await db
    .select({ githubId: githubLinks.githubId })
    .from(githubLinks)
    .where(eq(githubLinks.userId, actorUserId))
    .limit(1);

  const owns = (row: (typeof freeze.poolMembers)[number]) =>
    row.userId === actorUserId || (link != null && link.githubId === row.githubId);

  const byId = participantId
    ? freeze.poolMembers.find((row) => row.id === participantId)
    : undefined;
  if (participantId) {
    if (!byId || !owns(byId)) {
      throw new ClaimError("not_pool_member", NOT_POOL_MEMBER_MESSAGE);
    }
    return byId;
  }

  const member =
    freeze.poolMembers.find((row) => row.userId === actorUserId) ??
    freeze.poolMembers.find((row) => link != null && link.githubId === row.githubId);
  if (!member) {
    throw new ClaimError("not_pool_member", NOT_POOL_MEMBER_MESSAGE);
  }
  return member;
}

async function loadClaimForPayout(
  db: Database,
  bountyId: string,
  claimId: string | undefined,
  bounty: typeof bounties.$inferSelect,
): Promise<typeof claims.$inferSelect> {
  if (claimId) {
    const [row] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
    if (!row || row.bountyId !== bountyId) {
      throw new ClaimError("claim_not_found", "Claim not found on this bounty.");
    }
    if (row.status !== "eligible" && row.status !== "paid") {
      throw new ClaimError(
        "not_eligible",
        `This claim is ${row.status}, not eligible for payout.`,
      );
    }
    return row;
  }

  const rows = await db
    .select()
    .from(claims)
    .where(and(eq(claims.bountyId, bountyId), inArray(claims.status, ["eligible", "paid"])))
    .orderBy(desc(claims.updatedAt));

  const eligible = rows.find((row) => row.status === "eligible");
  const alreadyPaid = rows.find((row) => row.status === "paid");
  const row = eligible ?? alreadyPaid;
  if (!row) {
    const [repo] = await db
      .select({ fullName: repos.fullName })
      .from(repos)
      .where(eq(repos.id, bounty.repoId))
      .limit(1);
    if (repo) {
      const pending = await getPendingHunterLinkForBounty(db, {
        id: bounty.id,
        githubIssueNumber: bounty.githubIssueNumber,
        repoFullName: repo.fullName,
      });
      if (pending) {
        throw new ClaimError("hunter_not_linked", pendingHunterLinkGuidance(pending.winnerLogin));
      }
    }
    throw new ClaimError("not_eligible", NOT_ELIGIBLE_MESSAGE);
  }
  return row;
}
