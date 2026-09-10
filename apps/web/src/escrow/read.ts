import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { escrows } from "../db/schema";
import { hostedCheckoutStatus } from "./hosted";
import { isMockTxHash } from "./idempotency";
import { reconcileBountyNotes } from "./reconcile";
import type { EscrowStatus } from "./state";

export type EscrowSnapshot = {
  id: string;
  bountyId: string;
  status: EscrowStatus;
  amountUsdc: string;
  fundTxHash: string | null;
  payoutTxHash: string | null;
  feeTxHash: string | null;
  refundTxHash: string | null;
  escrowAddress: string | null;
  funderAddress: string | null;
  idempotencyKey: string | null;
  rail: "mock" | "cdp" | "unknown";
  hostedCheckout: ReturnType<typeof hostedCheckoutStatus>;
  reconcile: string[];
};

export async function getEscrowSnapshot(
  bountyId: string,
  db: Database,
): Promise<EscrowSnapshot | null> {
  const [row] = await db.select().from(escrows).where(eq(escrows.bountyId, bountyId)).limit(1);
  if (!row) return null;
  const hashes = [row.fundTxHash, row.payoutTxHash, row.feeTxHash, row.refundTxHash];
  const rail = hashes.some((h) => isMockTxHash(h))
    ? "mock"
    : hashes.some((h) => h?.startsWith("0x") || h?.startsWith("sepolia-dry-run:"))
      ? "cdp"
      : "unknown";
  return {
    id: row.id,
    bountyId: row.bountyId,
    status: row.status,
    amountUsdc: row.amountUsdc,
    fundTxHash: row.fundTxHash,
    payoutTxHash: row.payoutTxHash,
    feeTxHash: row.feeTxHash,
    refundTxHash: row.refundTxHash,
    escrowAddress: row.escrowAddress,
    funderAddress: row.funderAddress,
    idempotencyKey: row.idempotencyKey,
    rail,
    hostedCheckout: hostedCheckoutStatus(),
    reconcile: reconcileBountyNotes({
      bountyId: row.bountyId,
      faceUsdc: row.amountUsdc,
      escrowStatus: row.status,
      fundTxHash: row.fundTxHash,
      payoutTxHash: row.payoutTxHash,
      feeTxHash: row.feeTxHash,
      refundTxHash: row.refundTxHash,
    }),
  };
}
