import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, escrows } from "../db/schema";
import { payerDistinctFromEscrow } from "./destination-guard";
import { EscrowError } from "./errors";
import { DELETED_BOUNTY_INBOUND_CODE, DELETED_BOUNTY_INBOUND_REASON } from "./fail";
import { requireBasePayoutAddress } from "./payout-address";

/**
 * Choose the Lock fund hash.
 * Mock/local may use a pasted hash (tests). The live CDP rail never prefers
 * a pasted value: only the hash recorded by x402 settle for this bounty.
 */
export function resolveLockFundTxHash(input: {
  pasted?: string | null;
  recorded?: string | null;
  railMode?: "mock" | "cdp";
  /** True when `recorded` was written by x402 settle (`escrows.x402_payment_id`). */
  recordedByX402?: boolean;
}): string | undefined {
  const pasted = input.pasted?.trim() || "";
  const recorded = input.recorded?.trim() || "";
  if (input.railMode === "cdp") {
    if (pasted && (!input.recordedByX402 || pasted.toLowerCase() !== recorded.toLowerCase())) {
      throw new EscrowError(
        "fund_hash_not_verified",
        "Live rail only accepts the fund transaction recorded by x402 settle for this bounty. Paste-hash Lock is mock/local only.",
      );
    }
    return recorded || undefined;
  }
  if (pasted) return pasted;
  return recorded || undefined;
}

/** True when x402 inbound (or any fund hash) was persisted — including after Lock/settle. */
export function inboundIsRecorded(row: {
  status?: string | null;
  fundTxHash?: string | null;
  x402PaymentId?: string | null;
} | null | undefined): boolean {
  if (!row) return false;
  return Boolean(row.fundTxHash?.trim() || row.x402PaymentId?.trim());
}

type EscrowInboundRow = typeof escrows.$inferSelect;

/**
 * Keep the transaction on the escrow and mark it for ops review.
 * Never clears the review marker and never leaves a pending (fundable) row.
 */
export async function persistDeletedBountyInbound(
  db: Database,
  existing: EscrowInboundRow,
  input: {
    bountyId: string;
    txHash: string;
    paymentId: string;
    escrowAddress: string;
    resourceUrl: string;
    funderAddress?: string | null;
    now: Date;
  },
): Promise<{ alreadyRecorded: boolean; txHash: string; review: true }> {
  const txHash = input.txHash.trim().toLowerCase();
  const previous = existing.fundTxHash?.trim().toLowerCase() || "";
  const keepPrevious = Boolean(previous) && previous !== txHash;
  const payer = input.funderAddress?.trim() || "";
  const funderAddress =
    payer && payerDistinctFromEscrow(payer, input.escrowAddress)
      ? requireBasePayoutAddress(payer, "missing_funder_address")
      : existing.funderAddress;
  await db
    .update(escrows)
    .set({
      fundTxHash: keepPrevious ? existing.fundTxHash : txHash,
      x402PaymentId: existing.x402PaymentId?.trim() || input.paymentId || `x402:${txHash}`,
      x402Url: input.resourceUrl,
      escrowAddress: input.escrowAddress || existing.escrowAddress,
      funderAddress,
      failCode: DELETED_BOUNTY_INBOUND_CODE,
      failReason: keepPrevious
        ? `${DELETED_BOUNTY_INBOUND_REASON} Additional tx ${txHash}.`
        : DELETED_BOUNTY_INBOUND_REASON,
      status: existing.status === "pending" ? "failed" : existing.status,
      updatedAt: input.now,
    })
    .where(eq(escrows.id, existing.id));
  console.error(
    JSON.stringify({
      severity: "ERROR",
      event: "deleted_bounty_inbound",
      bountyId: input.bountyId,
      txHash,
      escrowStatus: existing.status === "pending" ? "failed" : existing.status,
      keptPreviousHash: keepPrevious,
    }),
  );
  return { alreadyRecorded: previous === txHash, txHash, review: true };
}

/**
 * Persist an x402 `exact` settlement on a still-pending escrow row.
 * Does not flip status to funded — poster Lock confirms FUND_IN.
 * A still-pending row with this real hash stays in recon as INBOUND_UNAPPLIED.
 */
export async function recordExactInbound(
  db: Database,
  input: {
    bountyId: string;
    txHash: string;
    x402PaymentId: string;
    escrowAddress: string;
    resourceUrl: string;
    funderAddress?: string | null;
    now?: Date;
  },
): Promise<{ alreadyRecorded: boolean; txHash: string; review?: boolean }> {
  const txHash = input.txHash.trim().toLowerCase();
  const paymentId = input.x402PaymentId.trim();
  if (!txHash) {
    throw new EscrowError(
      "x402_settle_failed",
      "x402 exact settlement returned no transaction hash. Do not mark funded. Retry Lock only after recon.",
    );
  }
  const now = input.now ?? new Date();
  const [existing] = await db.select().from(escrows).where(eq(escrows.bountyId, input.bountyId)).limit(1);
  const [bounty] = await db
    .select({ deletedAt: bounties.deletedAt })
    .from(bounties)
    .where(eq(bounties.id, input.bountyId))
    .limit(1);
  if (!existing) {
    if (bounty?.deletedAt) {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          event: "deleted_bounty_inbound",
          bountyId: input.bountyId,
          txHash,
          escrowStatus: "missing",
        }),
      );
    }
    throw new EscrowError("bounty_not_found", "Escrow row missing — cannot record inbound.");
  }
  if (bounty?.deletedAt) {
    return persistDeletedBountyInbound(db, existing, { ...input, txHash, paymentId, now });
  }
  if (existing.status !== "pending") {
    if (existing.fundTxHash?.trim().toLowerCase() === txHash) {
      return { alreadyRecorded: true, txHash };
    }
    throw new EscrowError(
      "not_fundable",
      `Escrow is ${existing.status}, not pending — will not overwrite inbound.`,
    );
  }
  const previous = existing.fundTxHash?.trim().toLowerCase();
  if (previous && previous !== txHash) {
    throw new EscrowError(
      "x402_settle_failed",
      "A different inbound hash is already recorded for this bounty. Do not settle twice.",
    );
  }
  if (previous === txHash && existing.x402PaymentId?.trim()) {
    return { alreadyRecorded: true, txHash };
  }

  // payTo is the escrow wallet. Storing it as funder_address made PROD
  // refunds look like they should pay gb-escrow (bounty bbcc9ee5).
  const payer = input.funderAddress?.trim() || "";
  if (payer && !payerDistinctFromEscrow(payer, input.escrowAddress)) {
    throw new EscrowError(
      "x402_settle_failed",
      "x402 payer is the escrow wallet (payTo), not the sender. Refusing to record it as funder_address.",
    );
  }
  const funderAddress = payer
    ? requireBasePayoutAddress(payer, "missing_funder_address")
    : existing.funderAddress;

  await db
    .update(escrows)
    .set({
      fundTxHash: txHash,
      x402PaymentId: paymentId || `x402:${txHash}`,
      x402Url: input.resourceUrl,
      escrowAddress: input.escrowAddress,
      funderAddress,
      failCode: null,
      failReason: null,
      updatedAt: now,
    })
    .where(eq(escrows.id, existing.id));

  return { alreadyRecorded: Boolean(previous), txHash };
}
