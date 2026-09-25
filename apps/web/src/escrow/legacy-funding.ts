import { eq, sql } from "drizzle-orm";
import { createPublicClient, http, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { Database } from "../db/client";
import { bountyContributions, escrows } from "../db/schema";
import { usdcToAtomic } from "../lib/money";
import { resolveFundWalletRuntime } from "../wallet/env";
import { isMainnetNetwork, type CdpRailMode } from "./env";
import {
  fundHashIsVerified,
  isChainTxHash,
  isPlaceholderFundHash,
  withVerifiedTopUpHash,
} from "./payout-guard";
import {
  listEscrowUsdcCredits,
  matchPayerFundingTransfer,
  type TxLog,
} from "../../scripts/security/match-usdc-transfer";

export type LegacyReceipt =
  | { ok: true; status: "success" | "reverted"; logs: TxLog[] }
  | { ok: false; reason: string };

export type LegacyChainReader = (txHash: string) => Promise<LegacyReceipt>;

export type FundingLegRecord = {
  bountyId: string;
  source: "contribution" | "escrow";
  contributionId: string | null;
  hash: string;
  amountUsdc: string;
  payer: string | null;
  escrowAddress: string | null;
  x402PaymentId: string | null;
  escrowFundTxHash: string | null;
};

export type FundingLegAssessment = FundingLegRecord & {
  countsNow: boolean;
  /** Chain check would append an `x402-topup:` line. */
  recordable: boolean;
  reason: string;
  /** On-chain Transfer `from` when a credit to escrow was seen. */
  chainFrom: string | null;
};

const PUBLIC_RPC: Record<number, string> = {
  8453: "https://mainnet.base.org",
  84532: "https://sepolia.base.org",
};

/** `BASE_RPC_URL` when Ops set it, otherwise the public Base RPC for this network. */
export function legacyRpcUrl(env: NodeJS.ProcessEnv, chainId: number): string {
  const configured = env.BASE_RPC_URL?.trim();
  if (configured) return configured;
  return PUBLIC_RPC[chainId] ?? PUBLIC_RPC[84532]!;
}

export function createLegacyChainReader(env: NodeJS.ProcessEnv = process.env): LegacyChainReader {
  const fund = resolveFundWalletRuntime(env);
  const client = createPublicClient({
    chain: fund.chainId === 8453 ? base : baseSepolia,
    transport: http(legacyRpcUrl(env, fund.chainId)),
  });
  let chainChecked = false;
  return async (txHash) => {
    try {
      if (!chainChecked) {
        const chainId = await client.getChainId();
        chainChecked = true;
        if (chainId !== fund.chainId) {
          return { ok: false, reason: `rpc_chain_mismatch:${chainId}` };
        }
      }
      const receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
      const logs: TxLog[] = receipt.logs.map((log, index) => ({
        address: log.address,
        topics: log.topics,
        data: log.data,
        logIndex: log.logIndex ?? index,
      }));
      return {
        ok: true,
        status: receipt.status === "success" ? "success" : "reverted",
        logs,
      };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "rpc_failed" };
    }
  };
}

export function legCountsNow(leg: FundingLegRecord, railMode: CdpRailMode): boolean {
  return fundHashIsVerified({
    hash: leg.hash,
    railMode,
    x402PaymentId: leg.x402PaymentId,
    escrowFundTxHash: leg.escrowFundTxHash,
  });
}

/**
 * Decide whether a funding hash may be marked guard-eligible.
 * `receipt` is omitted when the caller has not queried the chain yet.
 */
export function assessFundingLeg(input: {
  leg: FundingLegRecord;
  railMode: CdpRailMode;
  usedByOtherBounty: boolean;
  usdcContract: string;
  receipt?: LegacyReceipt | null;
}): FundingLegAssessment {
  const { leg } = input;
  const base = {
    ...leg,
    countsNow: legCountsNow(leg, input.railMode),
    recordable: false,
    reason: "counted",
    chainFrom: null as string | null,
  };
  if (base.countsNow) return base;
  if (isPlaceholderFundHash(leg.hash)) {
    return { ...base, reason: "placeholder" };
  }
  if (!isChainTxHash(leg.hash)) {
    return { ...base, reason: "not_a_chain_tx" };
  }
  if (input.usedByOtherBounty) {
    return { ...base, reason: "hash_reused" };
  }
  if (!leg.payer?.trim()) {
    return { ...base, reason: "missing_payer" };
  }
  if (!leg.escrowAddress?.trim()) {
    return { ...base, reason: "missing_escrow_address" };
  }
  if (!input.receipt) {
    return { ...base, reason: "needs_chain_check" };
  }
  if (!input.receipt.ok) {
    return { ...base, reason: input.receipt.reason || "rpc_failed" };
  }
  let amountAtomic: bigint;
  try {
    amountAtomic = usdcToAtomic(leg.amountUsdc);
  } catch {
    return { ...base, reason: "invalid_amount" };
  }
  const credits = listEscrowUsdcCredits({
    logs: input.receipt.logs,
    usdcContract: input.usdcContract,
    escrowWallet: leg.escrowAddress,
    amountAtomic,
    receiptStatus: input.receipt.status,
  });
  const chainFrom = credits[0]?.from ?? null;
  const matched = matchPayerFundingTransfer({
    logs: input.receipt.logs,
    usdcContract: input.usdcContract,
    escrowWallet: leg.escrowAddress,
    payer: leg.payer,
    amountAtomic,
    receiptStatus: input.receipt.status,
  });
  if (matched.ok) {
    return { ...base, recordable: true, reason: "chain_verified", chainFrom: matched.evidence.from };
  }
  if (matched.code === "sender_is_escrow" || (chainFrom && chainFrom.toLowerCase() !== leg.payer.trim().toLowerCase())) {
    return { ...base, reason: "payer_mismatch", chainFrom };
  }
  if (matched.code === "multiple_matches") {
    return { ...base, reason: "multiple_matches", chainFrom };
  }
  return { ...base, reason: "payer_or_amount_mismatch", chainFrom };
}

/** A bounty is at risk when any funding leg does not count toward the guard yet. */
export function bountyIsAtRisk(legs: readonly FundingLegAssessment[]): boolean {
  return legs.some((leg) => !leg.countsNow);
}

/**
 * `--apply` writes `x402-topup:` lines. Dry-run is always allowed, including
 * PROD. Applying on mainnet needs both the CLI flag and the env gate.
 */
export function applyGuardDecision(input: {
  apply: boolean;
  mainnet: boolean;
  allowProdFlag: boolean;
  allowProdEnv: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (!input.apply || !input.mainnet) return { ok: true };
  if (input.allowProdFlag && input.allowProdEnv) return { ok: true };
  return {
    ok: false,
    message:
      "Refusing --apply on PROD. Dry-run is read-only and allowed. --apply on PROD requires --allow-prod and LEGACY_FUND_RECONCILE_ALLOW_PROD=1.",
  };
}

export function isReconcileMainnet(env: NodeJS.ProcessEnv = process.env): boolean {
  const network = typeof env.CDP_NETWORK === "string" ? env.CDP_NETWORK : "";
  return isMainnetNetwork(network);
}

async function hashUsedByOtherBounty(db: Database, hash: string, bountyId: string): Promise<boolean> {
  const normalized = hash.trim().toLowerCase();
  const contributions = await db
    .select({ bountyId: bountyContributions.bountyId })
    .from(bountyContributions)
    .where(sql`lower(${bountyContributions.fundTxHash}) = ${normalized}`);
  if (contributions.some((row) => row.bountyId !== bountyId)) return true;
  const escrowRows = await db
    .select({ bountyId: escrows.bountyId })
    .from(escrows)
    .where(sql`lower(${escrows.fundTxHash}) = ${normalized}`);
  return escrowRows.some((row) => row.bountyId !== bountyId);
}

/**
 * Verify legacy live hashes on-chain and append `x402-topup:` lines for the
 * ones that match. Already-counted hashes are left alone. Failures are not
 * written. Returns the hashes newly recorded.
 */
export async function reconcileLegacyFunding(
  db: Database,
  bountyId: string,
  reader: LegacyChainReader,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const fund = resolveFundWalletRuntime(env);
  const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, bountyId)).limit(1);
  if (!escrow) return [];
  const contributions = await db
    .select({
      id: bountyContributions.id,
      amountUsdc: bountyContributions.amountUsdc,
      fundTxHash: bountyContributions.fundTxHash,
      funderAddress: bountyContributions.funderAddress,
    })
    .from(bountyContributions)
    .where(eq(bountyContributions.bountyId, bountyId));

  const legs: FundingLegRecord[] = contributions.map((row) => ({
    bountyId,
    source: "contribution" as const,
    contributionId: row.id,
    hash: row.fundTxHash,
    amountUsdc: row.amountUsdc,
    payer: row.funderAddress,
    escrowAddress: escrow.escrowAddress,
    x402PaymentId: escrow.x402PaymentId,
    escrowFundTxHash: escrow.fundTxHash,
  }));
  if (legs.length === 0 && escrow.fundTxHash) {
    legs.push({
      bountyId,
      source: "escrow",
      contributionId: null,
      hash: escrow.fundTxHash,
      amountUsdc: escrow.amountUsdc,
      payer: escrow.funderAddress,
      escrowAddress: escrow.escrowAddress,
      x402PaymentId: escrow.x402PaymentId,
      escrowFundTxHash: escrow.fundTxHash,
    });
  }

  const recorded: string[] = [];
  let paymentId = escrow.x402PaymentId;
  for (const leg of legs) {
    const current = { ...leg, x402PaymentId: paymentId };
    if (legCountsNow(current, "cdp")) continue;
    if (isPlaceholderFundHash(leg.hash) || !isChainTxHash(leg.hash)) continue;
    if (await hashUsedByOtherBounty(db, leg.hash, bountyId)) continue;
    const receipt = await reader(leg.hash);
    const assessed = assessFundingLeg({
      leg: current,
      railMode: "cdp",
      usedByOtherBounty: false,
      usdcContract: fund.usdc,
      receipt,
    });
    if (!assessed.recordable) continue;
    const next = withVerifiedTopUpHash(paymentId, leg.hash);
    if (next === (paymentId ?? "")) continue;
    await db
      .update(escrows)
      .set({ x402PaymentId: next, updatedAt: new Date() })
      .where(eq(escrows.id, escrow.id));
    paymentId = next;
    recorded.push(leg.hash.trim().toLowerCase());
  }
  return recorded;
}
