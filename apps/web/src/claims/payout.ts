import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, claims, users } from "../db/schema";
import { isEscrowError, settleEscrow, type SettleResult } from "../escrow";
import type { CdpRail } from "../escrow/rail";
import { INVALID_BASE_ADDRESS_MESSAGE, normalizeBaseAddress } from "../lib/address";
import { splitFaceUsdc } from "../lib/money";
import {
  ClaimError,
  NOT_ELIGIBLE_MESSAGE,
  NOT_HUNTER_MESSAGE,
} from "./errors";

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

export type ClaimPayoutOpts = {
  db: Database;
  rail?: CdpRail;
  now?: Date;
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

  const claim = await loadClaimForPayout(opts.db, bountyId, input.claimId);
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
        hunterUserId: claim.hunterUserId,
        hunterPayoutAddress: address,
        claimId: claim.id,
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

async function loadClaimForPayout(
  db: Database,
  bountyId: string,
  claimId?: string,
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
    throw new ClaimError("not_eligible", NOT_ELIGIBLE_MESSAGE);
  }
  return row;
}
