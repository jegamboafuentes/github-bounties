import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { bountyContributions, escrows } from "../db/schema";
import type { CdpRailMode } from "./env";
import { EscrowError } from "./errors";
import { resolveLockFundTxHash } from "./inbound";

const REUSED =
  "This fund transaction hash is already recorded on another bounty.";

/**
 * One confirmed fund hash can credit only one bounty. Same-bounty retries
 * (the existing contribution or escrow row) are allowed.
 */
export async function assertFundTxHashAvailable(
  db: Database,
  fundTxHash: string,
  bountyId: string,
): Promise<void> {
  const hash = fundTxHash.trim();
  if (!hash) return;

  const [contribution] = await db
    .select({ bountyId: bountyContributions.bountyId })
    .from(bountyContributions)
    .where(eq(bountyContributions.fundTxHash, hash))
    .limit(1);
  if (contribution && contribution.bountyId !== bountyId) {
    throw new EscrowError("fund_hash_reused", REUSED);
  }

  const [escrow] = await db
    .select({ bountyId: escrows.bountyId })
    .from(escrows)
    .where(eq(escrows.fundTxHash, hash))
    .limit(1);
  if (escrow && escrow.bountyId !== bountyId) {
    throw new EscrowError("fund_hash_reused", REUSED);
  }
}

/**
 * Live Lock: a caller-supplied hash must be the x402 settle hash already
 * stored for this bounty. Empty means "use the recorded hash" and is allowed.
 * Mock/local accepts a paste.
 */
export async function assertCallerLockHash(
  db: Database,
  bountyId: string,
  pasted: string | null | undefined,
  railMode: CdpRailMode,
): Promise<void> {
  if (railMode !== "cdp") return;
  const pastedHash = pasted?.trim() || "";
  if (!pastedHash) return;
  const [row] = await db
    .select({
      fundTxHash: escrows.fundTxHash,
      x402PaymentId: escrows.x402PaymentId,
    })
    .from(escrows)
    .where(eq(escrows.bountyId, bountyId))
    .limit(1);
  const recordedByX402 = Boolean(row?.x402PaymentId?.trim());
  resolveLockFundTxHash({
    pasted: pastedHash,
    recorded: recordedByX402 ? row?.fundTxHash : null,
    railMode: "cdp",
    recordedByX402,
  });
}

/** Live top-up pastes are never verified. x402 settle calls the service directly. */
export function assertCallerTopUpHash(
  pasted: string | null | undefined,
  railMode: CdpRailMode,
): void {
  if (railMode === "cdp" && pasted?.trim()) {
    throw new EscrowError(
      "fund_hash_not_verified",
      "Live rail top-up only accepts the transaction hash from x402 settle for this top-up. Paste-hash top-up is mock/local only.",
    );
  }
}
