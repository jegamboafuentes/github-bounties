import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { escrows } from "../db/schema";
import { EscrowError } from "./errors";

export function resolveLockFundTxHash(input: {
  pasted?: string | null;
  recorded?: string | null;
}): string | undefined {
  const pasted = input.pasted?.trim();
  if (pasted) return pasted;
  const recorded = input.recorded?.trim();
  return recorded || undefined;
}

export function inboundIsRecorded(row: {
  status?: string | null;
  fundTxHash?: string | null;
  x402PaymentId?: string | null;
} | null | undefined): boolean {
  if (!row) return false;
  if (row.status && row.status !== "pending") return false;
  return Boolean(row.fundTxHash?.trim() || row.x402PaymentId?.trim());
}

/**
 * Persist an x402 `exact` settlement on a still-pending escrow row.
 * Does not flip status to funded — poster Lock confirms FUND_IN.
 * Recon treats pending as 0 attributed, so storing the hash here is safe.
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
): Promise<{ alreadyRecorded: boolean; txHash: string }> {
  const txHash = input.txHash.trim();
  const paymentId = input.x402PaymentId.trim();
  if (!txHash) {
    throw new EscrowError(
      "x402_settle_failed",
      "x402 exact settlement returned no transaction hash. Do not mark funded. Retry Lock only after recon.",
    );
  }
  const now = input.now ?? new Date();
  const [existing] = await db.select().from(escrows).where(eq(escrows.bountyId, input.bountyId)).limit(1);
  if (!existing) {
    throw new EscrowError("bounty_not_found", "Escrow row missing — cannot record inbound.");
  }
  if (existing.status !== "pending") {
    if (existing.fundTxHash?.trim() === txHash) {
      return { alreadyRecorded: true, txHash };
    }
    throw new EscrowError(
      "not_fundable",
      `Escrow is ${existing.status}, not pending — will not overwrite inbound.`,
    );
  }
  const previous = existing.fundTxHash?.trim();
  if (previous && previous !== txHash) {
    throw new EscrowError(
      "x402_settle_failed",
      "A different inbound hash is already recorded for this bounty. Do not settle twice.",
    );
  }
  if (previous === txHash && existing.x402PaymentId?.trim()) {
    return { alreadyRecorded: true, txHash };
  }

  await db
    .update(escrows)
    .set({
      fundTxHash: txHash,
      x402PaymentId: paymentId || `x402:${txHash}`,
      x402Url: input.resourceUrl,
      escrowAddress: input.escrowAddress,
      funderAddress: input.funderAddress?.trim() || existing.funderAddress,
      failCode: null,
      failReason: null,
      updatedAt: now,
    })
    .where(eq(escrows.id, existing.id));

  return { alreadyRecorded: Boolean(previous), txHash };
}
