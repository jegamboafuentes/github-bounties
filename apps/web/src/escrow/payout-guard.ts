import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { allocationLedger, bountyContributions, escrows } from "../db/schema";
import { usdcToAtomic } from "../lib/money";
import { confirmedOutflowsFromLegs } from "./allocation";
import type { CdpRailMode } from "./env";
import { EscrowError } from "./errors";
import { isMockTxHash } from "./idempotency";

const TOP_UP_PREFIX = "x402-topup:";

/** Hashes appended to `escrows.x402_payment_id` when an x402 top-up settles. */
export function verifiedTopUpHashes(x402PaymentId: string | null | undefined): string[] {
  if (!x402PaymentId) return [];
  const hashes: string[] = [];
  for (const line of x402PaymentId.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(TOP_UP_PREFIX)) continue;
    const hash = trimmed.slice(TOP_UP_PREFIX.length).trim();
    if (hash) hashes.push(hash);
  }
  return hashes;
}

/** Keep the original x402 payment id and record another settled top-up hash. */
export function withVerifiedTopUpHash(
  x402PaymentId: string | null | undefined,
  fundTxHash: string,
): string {
  const hash = fundTxHash.trim();
  const existing = verifiedTopUpHashes(x402PaymentId);
  const hashes = existing.some((row) => row.toLowerCase() === hash.toLowerCase())
    ? existing
    : [...existing, hash];
  const head = (x402PaymentId ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(TOP_UP_PREFIX))
    .join("\n");
  const tail = hashes.map((row) => `${TOP_UP_PREFIX}${row}`);
  return [head, ...tail].filter(Boolean).join("\n");
}

/**
 * A hash counts as verified inflow when the rail minted it (`mock:` / dry-run),
 * when the bounty is on the mock rail (paste is the local fund path), or on
 * the live rail when x402 settle recorded it (lock hash or top-up hash).
 */
export function fundHashIsVerified(input: {
  hash: string | null | undefined;
  railMode: CdpRailMode;
  x402PaymentId?: string | null;
  escrowFundTxHash?: string | null;
}): boolean {
  const hash = input.hash?.trim() || "";
  if (!hash) return false;
  if (isMockTxHash(hash) || hash.startsWith("sepolia-dry-run:")) return true;
  if (input.railMode === "mock") return true;
  const paymentId = input.x402PaymentId?.trim() || "";
  if (!paymentId) return false;
  const lockHash = input.escrowFundTxHash?.trim() || "";
  if (lockHash && lockHash.toLowerCase() === hash.toLowerCase()) return true;
  return verifiedTopUpHashes(paymentId).some((row) => row.toLowerCase() === hash.toLowerCase());
}

export function verifiedInflowAtomic(input: {
  railMode: CdpRailMode;
  escrow: {
    amountUsdc: string;
    fundTxHash: string | null;
    x402PaymentId: string | null;
  } | null;
  contributions: { amountUsdc: string; fundTxHash: string }[];
}): bigint {
  const verified = (hash: string | null | undefined) =>
    fundHashIsVerified({
      hash,
      railMode: input.railMode,
      x402PaymentId: input.escrow?.x402PaymentId,
      escrowFundTxHash: input.escrow?.fundTxHash,
    });
  if (input.contributions.length > 0) {
    return input.contributions.reduce((sum, row) => {
      if (!verified(row.fundTxHash)) return sum;
      return sum + usdcToAtomic(row.amountUsdc);
    }, BigInt(0));
  }
  if (input.escrow && verified(input.escrow.fundTxHash)) {
    return usdcToAtomic(input.escrow.amountUsdc);
  }
  return BigInt(0);
}

export function alreadyPaidAtomic(input: {
  legs: { kind: string; amountUsdc: string; txHash: string | null; status: string }[];
  refundedContributions: { amountUsdc: string; refundTxHash: string | null }[];
}): bigint {
  const out = confirmedOutflowsFromLegs(input.legs);
  let paid = out.winnerAtomic + out.poolAtomic + out.feeAtomic;
  for (const row of input.refundedContributions) {
    if (row.refundTxHash?.trim()) paid += usdcToAtomic(row.amountUsdc);
  }
  return paid;
}

/**
 * Refuse a settle, claim, pool claim, or refund leg that verified inflows
 * cannot cover after amounts already paid. Logs `insufficient_bounty_funds`.
 */
export async function assertPayoutCovered(
  db: Database,
  bountyId: string,
  legAtomic: bigint,
  railMode: CdpRailMode,
): Promise<void> {
  if (legAtomic <= BigInt(0)) return;
  const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, bountyId)).limit(1);
  const contributions = await db
    .select({
      amountUsdc: bountyContributions.amountUsdc,
      fundTxHash: bountyContributions.fundTxHash,
      refundTxHash: bountyContributions.refundTxHash,
    })
    .from(bountyContributions)
    .where(eq(bountyContributions.bountyId, bountyId));
  const legs = await db
    .select({
      kind: allocationLedger.kind,
      amountUsdc: allocationLedger.amountUsdc,
      txHash: allocationLedger.txHash,
      status: allocationLedger.status,
    })
    .from(allocationLedger)
    .where(eq(allocationLedger.bountyId, bountyId));
  const verified = verifiedInflowAtomic({
    railMode,
    escrow: escrow
      ? {
          amountUsdc: escrow.amountUsdc,
          fundTxHash: escrow.fundTxHash,
          x402PaymentId: escrow.x402PaymentId,
        }
      : null,
    contributions,
  });
  const paid = alreadyPaidAtomic({ legs, refundedContributions: contributions });
  if (verified - paid < legAtomic) {
    console.error(
      JSON.stringify({
        event: "insufficient_bounty_funds",
        bountyId,
        legAtomic: legAtomic.toString(),
        verifiedAtomic: verified.toString(),
        paidAtomic: paid.toString(),
        railMode,
      }),
    );
    throw new EscrowError(
      "insufficient_bounty_funds",
      "Refusing payout: verified inflows for this bounty do not cover the leg after amounts already paid.",
    );
  }
}
