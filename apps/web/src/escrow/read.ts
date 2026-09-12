import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { escrows } from "../db/schema";
import { probeCdpEnv, type CdpRailMode } from "./env";
import { formatEscrowFailLabel } from "./fail";
import { hostedCheckoutStatus } from "./hosted";
import { isMockTxHash } from "./idempotency";
import { reconcileBountyNotes } from "./reconcile";
import type { EscrowStatus } from "./state";

export type EscrowRailLabel = CdpRailMode | "unknown";

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
  failCode: string | null;
  failReason: string | null;
  failLabel: string | null;
  rail: EscrowRailLabel;
  hostedCheckout: ReturnType<typeof hostedCheckoutStatus>;
  reconcile: string[];
};

/**
 * Infer rail from persisted hashes. With no hash (pending / failed Lock)
 * fall back to the current CDP probe so the UI does not say "rail unknown".
 */
export function inferEscrowRail(
  hashes: (string | null | undefined)[],
  probeMode: CdpRailMode = probeCdpEnv().mode,
): EscrowRailLabel {
  if (hashes.some((h) => isMockTxHash(h))) return "mock";
  if (hashes.some((h) => h?.startsWith("0x") || h?.startsWith("sepolia-dry-run:"))) {
    return "cdp";
  }
  return probeMode;
}

export async function getEscrowSnapshot(
  bountyId: string,
  db: Database,
): Promise<EscrowSnapshot | null> {
  const [row] = await db.select().from(escrows).where(eq(escrows.bountyId, bountyId)).limit(1);
  if (!row) return null;
  const hashes = [row.fundTxHash, row.payoutTxHash, row.feeTxHash, row.refundTxHash];
  const rail = inferEscrowRail(hashes);
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
    failCode: row.failCode,
    failReason: row.failReason,
    failLabel: formatEscrowFailLabel(row.failCode, row.failReason),
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
