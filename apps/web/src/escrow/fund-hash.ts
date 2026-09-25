import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { bountyContributions, escrows } from "../db/schema";
import { BASE_MAINNET_CAIP2, BASE_SEPOLIA_CAIP2 } from "../lib/constants";
import { logMoneyAction, takeRequestId, type MoneyAction } from "./actor-log";
import type { CdpRailMode } from "./env";
import { EscrowError } from "./errors";
import { resolveLockFundTxHash } from "./inbound";

const REUSED =
  "This fund transaction hash is already recorded on another bounty.";

/** Store and compare fund hashes in one case. Empty stays empty. */
export function normalizeFundTxHash(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function fundHashEquals(column: typeof bountyContributions.fundTxHash | typeof escrows.fundTxHash, hash: string) {
  return sql`lower(${column}) = ${hash}`;
}

/**
 * One confirmed fund hash can credit only one bounty. Same-bounty retries
 * (the existing contribution or escrow row) are allowed. Comparison is
 * case-insensitive so 0xAbC and 0xabc are the same inbound.
 */
export async function assertFundTxHashAvailable(
  db: Database,
  fundTxHash: string,
  bountyId: string,
): Promise<void> {
  const hash = normalizeFundTxHash(fundTxHash);
  if (!hash) return;

  const [contribution] = await db
    .select({ bountyId: bountyContributions.bountyId })
    .from(bountyContributions)
    .where(fundHashEquals(bountyContributions.fundTxHash, hash))
    .limit(1);
  if (contribution && contribution.bountyId !== bountyId) {
    throw new EscrowError("fund_hash_reused", REUSED);
  }

  const [escrow] = await db
    .select({ bountyId: escrows.bountyId })
    .from(escrows)
    .where(fundHashEquals(escrows.fundTxHash, hash))
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

const BASE_NETWORK_ALIASES = new Set([
  "base",
  "base-mainnet",
  "mainnet",
  BASE_MAINNET_CAIP2,
]);
const SEPOLIA_NETWORK_ALIASES = new Set(["base-sepolia", BASE_SEPOLIA_CAIP2]);

/** `base` on PROD, `base-sepolia` on DEV. Unknown strings are not coerced to Sepolia. */
export function x402ChainOf(network: string | null | undefined): "base" | "base-sepolia" | null {
  const n = network?.trim().toLowerCase() ?? "";
  if (!n) return null;
  if (BASE_NETWORK_ALIASES.has(n)) return "base";
  if (SEPOLIA_NETWORK_ALIASES.has(n)) return "base-sepolia";
  return null;
}

export type X402IssuedRequirement = {
  /** Env network (`base` / `base-sepolia`) or its CAIP-2 id. */
  network: string;
  payTo: string;
  asset: string;
  /** Atomic USDC units of the requirement we issued. */
  amount: string;
};

export type X402RequirementFields = {
  network?: string | null;
  payTo?: string | null;
  asset?: string | null;
  amount?: string | null;
};

/**
 * Facilitator settle response plus the requirement the client paid and the
 * requirement the server asked the facilitator to settle.
 */
export type FacilitatorSettlementCheck = {
  bountyId: string;
  issued: X402IssuedRequirement;
  observed: {
    /** `network` on the facilitator settle response. */
    network?: string | null;
    /** payTo / asset / amount on the requirement passed to settle. */
    payTo?: string | null;
    asset?: string | null;
    amount?: string | null;
    /** Present when the facilitator reports the amount that actually settled. */
    settledAmount?: string | null;
    /** `paymentPayload.accepted`. Required. */
    accepted?: X402RequirementFields | null;
  };
  actorUserId?: string | null;
  requestId?: string | null;
  action?: MoneyAction;
  txHash?: string | null;
};

function sameToken(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = left?.trim() ?? "";
  const b = right?.trim() ?? "";
  return Boolean(a) && a.toLowerCase() === b.toLowerCase();
}

function sameAtomic(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = left?.trim() ?? "";
  const b = right?.trim() ?? "";
  if (!a || !b) return false;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

function failFacilitatorSettlement(
  input: FacilitatorSettlementCheck,
  field: string,
  message: string,
): never {
  logMoneyAction({
    action: input.action ?? "lock",
    actorUserId: input.actorUserId ?? null,
    bountyId: input.bountyId,
    payer: null,
    amountUsdc: null,
    txHash: input.txHash ?? null,
    result: "x402_settle_mismatch",
    requestId: takeRequestId(input.requestId),
  });
  throw new EscrowError("x402_settle_mismatch", message, { details: { field } });
}

/**
 * Accept a facilitator settle only when its network is the env chain
 * (Base on PROD, Base Sepolia on DEV) and payTo, asset, and amount match
 * the requirement we issued. Does not read an RPC receipt.
 */
export function assertFacilitatorSettlementMatches(input: FacilitatorSettlementCheck): void {
  const expectedChain = x402ChainOf(input.issued.network);
  const returnedChain = x402ChainOf(input.observed.network);
  if (!expectedChain || returnedChain !== expectedChain) {
    failFacilitatorSettlement(
      input,
      "network",
      `x402 facilitator settlement network ${input.observed.network?.trim() || "(missing)"} does not match the expected network ${input.issued.network.trim() || "(missing)"}.`,
    );
  }
  if (!sameToken(input.observed.payTo, input.issued.payTo)) {
    failFacilitatorSettlement(
      input,
      "payTo",
      "x402 facilitator settlement payTo does not match the requirement we issued.",
    );
  }
  if (!sameToken(input.observed.asset, input.issued.asset)) {
    failFacilitatorSettlement(
      input,
      "asset",
      "x402 facilitator settlement asset does not match the requirement we issued.",
    );
  }
  if (!sameAtomic(input.observed.amount, input.issued.amount)) {
    failFacilitatorSettlement(
      input,
      "amount",
      "x402 facilitator settlement amount does not match the requirement we issued.",
    );
  }
  const settledAmount = input.observed.settledAmount?.trim() ?? "";
  if (settledAmount && !sameAtomic(settledAmount, input.issued.amount)) {
    failFacilitatorSettlement(
      input,
      "settledAmount",
      "x402 facilitator settlement amount does not match the requirement we issued.",
    );
  }
  const accepted = input.observed.accepted;
  if (!accepted) {
    failFacilitatorSettlement(
      input,
      "accepted",
      "x402 facilitator settlement is missing the paid requirement (payTo, asset, and amount).",
    );
  }
  const acceptedChain = x402ChainOf(accepted.network);
  if (acceptedChain !== expectedChain) {
    failFacilitatorSettlement(
      input,
      "accepted.network",
      `x402 paid requirement network ${accepted.network?.trim() || "(missing)"} does not match the expected network ${input.issued.network.trim() || "(missing)"}.`,
    );
  }
  if (!sameToken(accepted.payTo, input.issued.payTo)) {
    failFacilitatorSettlement(
      input,
      "accepted.payTo",
      "x402 paid requirement payTo does not match the requirement we issued.",
    );
  }
  if (!sameToken(accepted.asset, input.issued.asset)) {
    failFacilitatorSettlement(
      input,
      "accepted.asset",
      "x402 paid requirement asset does not match the requirement we issued.",
    );
  }
  if (!sameAtomic(accepted.amount, input.issued.amount)) {
    failFacilitatorSettlement(
      input,
      "accepted.amount",
      "x402 paid requirement amount does not match the requirement we issued.",
    );
  }
}

export function readX402Requirement(value: unknown): X402RequirementFields | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return {
    network: typeof row.network === "string" ? row.network : null,
    payTo: typeof row.payTo === "string" ? row.payTo : null,
    asset: typeof row.asset === "string" ? row.asset : null,
    amount: typeof row.amount === "string" || typeof row.amount === "number" ? String(row.amount) : null,
  };
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
