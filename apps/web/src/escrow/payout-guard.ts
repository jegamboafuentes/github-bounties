import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { allocationLedger, bountyContributions, escrows } from "../db/schema";
import { usdcToAtomic } from "../lib/money";
import { confirmedOutflowsFromLegs } from "./allocation";
import type { CdpRailMode } from "./env";
import { EscrowError } from "./errors";
import { isMockTxHash } from "./idempotency";

const CHAIN_TX_RE = /^0x[0-9a-fA-F]{64}$/;

/** 32-byte hex transaction hash. Placeholders and pasted labels are not. */
export function isChainTxHash(value: string | null | undefined): value is string {
  return Boolean(value && CHAIN_TX_RE.test(value.trim()));
}

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
  const hash = fundTxHash.trim().toLowerCase();
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
 * `lock:` / `legacy-fund:` backfill keys and any non-transaction string.
 * These never count as live inflows. `mock:` and dry-run hashes are not
 * placeholders; the mock rail still accepts them.
 */
export function isPlaceholderFundHash(hash: string | null | undefined): boolean {
  const value = hash?.trim() ?? "";
  if (!value) return true;
  const lower = value.toLowerCase();
  if (lower.startsWith("mock:") || lower.startsWith("sepolia-dry-run:")) return false;
  if (lower.startsWith("lock:") || lower.startsWith("legacy-fund:")) return true;
  return !isChainTxHash(value);
}

/** Original x402 payment id, without `x402-topup:` lines. */
export function x402PaymentHead(x402PaymentId: string | null | undefined): string {
  if (!x402PaymentId) return "";
  return x402PaymentId
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(TOP_UP_PREFIX))
    .join("\n");
}

/**
 * A hash counts as verified inflow when the rail minted it (`mock:` / dry-run),
 * when the bounty is on the mock rail (paste is the local fund path), or on
 * the live rail when x402 settle recorded it.
 *
 * A live lock hash counts only when `x402_payment_id` still has a non-top-up
 * head (the facilitator payment id) and the hash is the escrow fund hash.
 * A top-up line by itself does not unlock a different lock hash.
 * Placeholder hashes never count on the live rail.
 * A legacy hash counts after it is recorded with `withVerifiedTopUpHash`.
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
  if (isPlaceholderFundHash(hash)) return false;
  const paymentId = input.x402PaymentId?.trim() || "";
  if (!paymentId) return false;
  if (verifiedTopUpHashes(paymentId).some((row) => row.toLowerCase() === hash.toLowerCase())) {
    return true;
  }
  const lockHash = input.escrowFundTxHash?.trim() || "";
  if (!x402PaymentHead(paymentId) || !lockHash) return false;
  return lockHash.toLowerCase() === hash.toLowerCase();
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

export type PayoutCoverage = {
  verifiedAtomic: bigint;
  paidAtomic: bigint;
};

/** Verified inflow and already-paid totals for one bounty. No chain calls. */
export async function loadPayoutCoverage(
  db: Database,
  bountyId: string,
  railMode: CdpRailMode,
): Promise<PayoutCoverage> {
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
  const verifiedAtomic = verifiedInflowAtomic({
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
  const paidAtomic = alreadyPaidAtomic({ legs, refundedContributions: contributions });
  return { verifiedAtomic, paidAtomic };
}

/** Cloud Logging reads `severity` off a JSON stdout/stderr line. */
export function logInsufficientBountyFunds(fields: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      severity: "ERROR",
      event: "insufficient_bounty_funds",
      ...fields,
    }),
  );
}

/**
 * Refuse a settle, claim, pool claim, or refund leg that verified inflows
 * cannot cover after amounts already paid. Second defense behind the
 * up-front sum check. Logs `insufficient_bounty_funds` at ERROR.
 */
export async function assertPayoutCovered(
  db: Database,
  bountyId: string,
  legAtomic: bigint,
  railMode: CdpRailMode,
): Promise<void> {
  if (legAtomic <= BigInt(0)) return;
  const { verifiedAtomic, paidAtomic } = await loadPayoutCoverage(db, bountyId, railMode);
  if (verifiedAtomic - paidAtomic < legAtomic) {
    logInsufficientBountyFunds({
      bountyId,
      legAtomic: legAtomic.toString(),
      verifiedAtomic: verifiedAtomic.toString(),
      paidAtomic: paidAtomic.toString(),
      requiredAtomic: legAtomic.toString(),
      railMode,
    });
    throw new EscrowError(
      "insufficient_bounty_funds",
      "Refusing payout: verified inflows for this bounty do not cover the leg after amounts already paid.",
      {
        details: {
          verifiedAtomic: verifiedAtomic.toString(),
          paidAtomic: paidAtomic.toString(),
          requiredAtomic: legAtomic.toString(),
        },
      },
    );
  }
}
