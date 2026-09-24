import { and, eq, inArray } from "drizzle-orm";
import { getAddress, isAddress } from "viem";
import type { Database } from "../db/client";
import {
  bounties,
  bountyContributions,
  claims,
  escrows,
  poolParticipants,
  users,
} from "../db/schema";
import { EscrowError } from "./errors";
import type { CdpRail, RailTransferPurpose } from "./rail";
import type { MoneyKind } from "./state";

export type TransferDestinationKind = "WINNER_PAYOUT" | "POOL_PAYOUT" | "FEE_OUT" | "REFUND_OUT";

/**
 * EIP-55 when both sides are real Base addresses. Mock fee/escrow sentinels
 * are not 40 hex chars, so those compare as the same string ignoring case.
 * A lookalike vanity address is a different value and does not match.
 */
export function sameStoredDestination(intended: string, stored: string): boolean {
  const left = intended.trim();
  const right = stored.trim();
  if (!left || !right) return false;
  if (isAddress(left) && isAddress(right)) {
    return getAddress(left) === getAddress(right);
  }
  return left.toLowerCase() === right.toLowerCase();
}

export function assertDestinationEquals(intended: string, stored: string): void {
  if (sameStoredDestination(intended, stored)) return;
  console.error(
    JSON.stringify({
      event: "destination_mismatch",
      intended: intended.trim() || null,
      stored: stored.trim() || null,
    }),
  );
  throw new EscrowError(
    "destination_mismatch",
    "Transfer destination does not match the address stored for this payout.",
  );
}

/** A payer that is missing or is the escrow wallet itself is not a funder. */
export function payerDistinctFromEscrow(
  payer: string | null | undefined,
  escrowAddress: string | null | undefined,
): string | null {
  const candidate = payer?.trim() || "";
  if (!candidate) return null;
  const escrow = escrowAddress?.trim() || "";
  if (escrow && candidate.toLowerCase() === escrow.toLowerCase()) return null;
  return candidate;
}

/**
 * Re-read the only address this leg is allowed to pay.
 * Winner: claims.payout_address, else the hunter's saved wallet.
 * Pool: pool_participants.payout_address, else that member's saved wallet.
 * Fee: the rail's gb-fee account (env/CDP), never a row from the request.
 * Refund: recorded payer that is not the escrow wallet, else the poster's saved wallet.
 * Split refund: that contribution's recorded funder, else that funder's saved wallet.
 */
export async function readStoredTransferDestination(
  db: Database,
  input: {
    bountyId: string;
    kind: TransferDestinationKind;
    claimId?: string | null;
    participantId?: string | null;
    contributionId?: string | null;
    loadFeeAddress: () => Promise<string>;
  },
): Promise<string> {
  if (input.kind === "FEE_OUT") {
    return (await input.loadFeeAddress()).trim();
  }
  if (input.kind === "WINNER_PAYOUT") {
    const claim = await loadPayoutClaim(db, input.bountyId, input.claimId);
    const fromClaim = claim?.payoutAddress?.trim() || "";
    if (fromClaim) return fromClaim;
    if (!claim) return "";
    return (await walletOf(db, claim.hunterUserId)) ?? "";
  }
  if (input.kind === "POOL_PAYOUT") {
    if (!input.participantId) return "";
    const [member] = await db
      .select()
      .from(poolParticipants)
      .where(eq(poolParticipants.id, input.participantId))
      .limit(1);
    if (!member || member.bountyId !== input.bountyId) return "";
    const fromRow = member.payoutAddress?.trim() || "";
    if (fromRow) return fromRow;
    if (!member.userId) return "";
    return (await walletOf(db, member.userId)) ?? "";
  }

  const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, input.bountyId)).limit(1);
  if (input.contributionId) {
    const [row] = await db
      .select({
        funderAddress: bountyContributions.funderAddress,
        funderUserId: bountyContributions.funderUserId,
      })
      .from(bountyContributions)
      .where(eq(bountyContributions.id, input.contributionId))
      .limit(1);
    const fromRow = payerDistinctFromEscrow(row?.funderAddress, escrow?.escrowAddress);
    if (fromRow) return fromRow;
    if (!row) return "";
    return (await walletOf(db, row.funderUserId)) ?? "";
  }

  const recorded = payerDistinctFromEscrow(escrow?.funderAddress, escrow?.escrowAddress);
  if (recorded) return recorded;
  const [bounty] = await db
    .select({ posterUserId: bounties.posterUserId })
    .from(bounties)
    .where(eq(bounties.id, input.bountyId))
    .limit(1);
  if (!bounty) return "";
  return (await walletOf(db, bounty.posterUserId)) ?? "";
}

/**
 * Compare `to` with a freshly read stored address, then transfer.
 * The rail is not called when they differ.
 */
export async function releaseUsdcIfMatch(args: {
  to: string;
  readStored: () => Promise<string>;
  transfer: () => Promise<{ txHash: string }>;
}): Promise<{ txHash: string }> {
  const stored = await args.readStored();
  assertDestinationEquals(args.to, stored);
  return args.transfer();
}

/**
 * Single guard in front of every outbound USDC transfer.
 * Re-reads the stored destination from the DB or the fee wallet and refuses
 * if `to` is anything else.
 */
export async function transferToStoredDestination(args: {
  db: Database;
  bountyId: string;
  to: string;
  kind: TransferDestinationKind;
  claimId?: string | null;
  participantId?: string | null;
  contributionId?: string | null;
  rail: CdpRail;
  amountAtomic: bigint;
  idempotencyKey: string;
  purpose: RailTransferPurpose;
  railKind: MoneyKind;
}): Promise<{ txHash: string }> {
  return releaseUsdcIfMatch({
    to: args.to,
    readStored: () =>
      readStoredTransferDestination(args.db, {
        bountyId: args.bountyId,
        kind: args.kind,
        claimId: args.claimId,
        participantId: args.participantId,
        contributionId: args.contributionId,
        loadFeeAddress: async () => (await args.rail.ensureWallets()).feeAddress,
      }),
    transfer: () =>
      args.rail.transferUsdc({
        to: args.to,
        amountAtomic: args.amountAtomic,
        idempotencyKey: args.idempotencyKey,
        purpose: args.purpose,
        kind: args.railKind,
      }),
  });
}

async function loadPayoutClaim(db: Database, bountyId: string, claimId?: string | null) {
  if (claimId) {
    const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
    if (!claim || claim.bountyId !== bountyId) return null;
    return claim;
  }
  const [eligible] = await db
    .select()
    .from(claims)
    .where(and(eq(claims.bountyId, bountyId), eq(claims.status, "eligible")))
    .limit(1);
  if (eligible) return eligible;
  const [paid] = await db
    .select()
    .from(claims)
    .where(and(eq(claims.bountyId, bountyId), inArray(claims.status, ["paid"])))
    .limit(1);
  return paid ?? null;
}

async function walletOf(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.walletAddress?.trim() || null;
}
