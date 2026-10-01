import { sql } from "drizzle-orm";
import { createPublicClient, getAddress, http, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { EnvMap } from "../auth/env";
import type { Database } from "../db/client";
import { isMainnetNetwork, readCdpNetwork } from "../escrow/env";
import { USDC_BASE_MAINNET, USDC_BASE_SEPOLIA } from "../lib/constants";
import { atomicToUsdc } from "../lib/money";
import { cdpNamedAccountClient, loadFeeAndEscrowAccounts, type NamedAccountClient } from "./fee-account";

const BALANCE_OF = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

export type BalanceTile = { usdc: string | null; error: string | null };
export type AddressTile = { address: string | null; error: string | null };

export type BalanceReport = {
  network: string;
  escrowAddress: AddressTile;
  feeAddress: AddressTile;
  escrowOnChain: BalanceTile;
  liabilities: BalanceTile;
  feeOnChain: BalanceTile;
  feesEarned: BalanceTile;
  feesWithdrawn: BalanceTile;
};

export type BalanceReaders = {
  network: string;
  loadAccounts: () => Promise<{ escrowAddress: string; feeAddress: string }>;
  feeAddressFallback?: () => string | null;
  readOnChain: (address: string) => Promise<bigint>;
  liabilities: () => Promise<bigint>;
  feesEarned: () => Promise<bigint>;
  feesWithdrawn: () => Promise<bigint>;
  log?: (tile: string, reason: string) => void;
};

function usdcFor(network: string): Address {
  return (isMainnetNetwork(network) ? USDC_BASE_MAINNET : USDC_BASE_SEPOLIA) as Address;
}

export function rpcUrlFor(env: EnvMap, network: string): string {
  const configured = env.BASE_RPC_URL?.trim();
  if (configured) return configured;
  return isMainnetNetwork(network) ? "https://mainnet.base.org" : "https://sepolia.base.org";
}

export function feeAddressFromEnv(env: EnvMap): string | null {
  const raw = env.FEE_WALLET_ADDRESS?.trim() ?? "";
  if (!raw) return null;
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

/** Short operator-facing reason. Strips secret assignments. Never includes a stack. */
export function balanceFailureReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Balance read failed.";
  const cleaned = raw
    .replace(/-----BEGIN[\s\S]*?-----END[^\n-]*-----/g, "[redacted]")
    .replace(/(?:api[_-]?key[_-]?secret|api[_-]?key|secret|token|password|bearer)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "Balance read failed.").slice(0, 240);
}

function logTile(log: BalanceReaders["log"], tile: string, reason: string): void {
  if (log) {
    log(tile, reason);
    return;
  }
  console.error(
    JSON.stringify({
      severity: "ERROR",
      event: "admin_balance_tile_failed",
      tile,
      reason,
    }),
  );
}

async function settle<T>(
  tile: string,
  run: () => Promise<T>,
  log: BalanceReaders["log"],
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    const reason = balanceFailureReason(err);
    logTile(log, tile, reason);
    return { ok: false, reason };
  }
}

function usdcTile(result: { ok: true; value: bigint } | { ok: false; reason: string }): BalanceTile {
  if (!result.ok) return { usdc: null, error: result.reason };
  return { usdc: atomicToUsdc(result.value), error: null };
}

/**
 * Each tile is its own try. A CDP, RPC, or SQL failure on one tile does not blank the others.
 * On-chain reads are USDC `balanceOf` over the public Base RPC, not a CDP transfer.
 */
export async function readBalanceTiles(readers: BalanceReaders): Promise<BalanceReport> {
  const accounts = await settle("cdp_accounts", readers.loadAccounts, readers.log);
  let escrowAddress: AddressTile;
  let feeAddress: AddressTile;
  if (accounts.ok) {
    escrowAddress = { address: accounts.value.escrowAddress, error: null };
    feeAddress = { address: accounts.value.feeAddress, error: null };
  } else {
    escrowAddress = { address: null, error: accounts.reason };
    const fallback = readers.feeAddressFallback?.() ?? null;
    feeAddress = fallback
      ? { address: fallback, error: null }
      : { address: null, error: accounts.reason };
  }

  const [escrowOnChain, feeOnChain, liabilities, feesEarned, feesWithdrawn] = await Promise.all([
    escrowAddress.address
      ? settle("escrow_on_chain", () => readers.readOnChain(escrowAddress.address as string), readers.log)
      : Promise.resolve({ ok: false as const, reason: escrowAddress.error ?? "Escrow address is unavailable." }),
    feeAddress.address
      ? settle("fee_on_chain", () => readers.readOnChain(feeAddress.address as string), readers.log)
      : Promise.resolve({ ok: false as const, reason: feeAddress.error ?? "Fee address is unavailable." }),
    settle("liabilities", readers.liabilities, readers.log),
    settle("fees_earned", readers.feesEarned, readers.log),
    settle("fees_withdrawn", readers.feesWithdrawn, readers.log),
  ]);

  return {
    network: readers.network,
    escrowAddress,
    feeAddress,
    escrowOnChain: usdcTile(escrowOnChain),
    liabilities: usdcTile(liabilities),
    feeOnChain: usdcTile(feeOnChain),
    feesEarned: usdcTile(feesEarned),
    feesWithdrawn: usdcTile(feesWithdrawn),
  };
}

export async function readOnChainUsdcBalance(
  address: string,
  env: EnvMap = process.env,
): Promise<bigint> {
  const network = readCdpNetwork(env);
  const client = createPublicClient({
    chain: isMainnetNetwork(network) ? base : baseSepolia,
    transport: http(rpcUrlFor(env, network)),
  });
  return client.readContract({
    address: usdcFor(network),
    abi: BALANCE_OF,
    functionName: "balanceOf",
    args: [address as Address],
  });
}

type Scalar = { n?: unknown };

function scalar(result: unknown): bigint {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === "object" && "rows" in result
      ? ((result as { rows: unknown }).rows as unknown[])
      : [];
  const raw = (rows[0] as Scalar | undefined)?.n;
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return BigInt(Math.trunc(raw));
  if (typeof raw === "string" && /^-?\d+$/.test(raw)) return BigInt(raw);
  return BigInt(0);
}

/**
 * Face still owed from open escrows, minus confirmed payout legs and recorded refunds.
 * Refunds live on `escrows.refund_tx_hash` and `bounty_contributions.refund_tx_hash`.
 * `allocation_ledger_kind` is only FEE_OUT, WINNER_PAYOUT, and POOL_PAYOUT.
 * Deleted bounties are excluded.
 */
export async function expectedEscrowLiabilitiesAtomic(db: Database): Promise<bigint> {
  const result = await db.execute(sql`
    select coalesce(sum(
      case
        when e.status in ('refunded', 'settled') then 0
        when e.status in ('pending', 'failed') and (
          (e.x402_payment_id is not null and btrim(e.x402_payment_id) <> '')
          or (
            e.fund_tx_hash is not null
            and btrim(e.fund_tx_hash) <> ''
            and e.fund_tx_hash not like 'mock:%'
          )
        ) then (e.amount_usdc * 1000000)::bigint
        when e.status in ('pending', 'failed') then 0
        else greatest(
          0,
          (e.amount_usdc * 1000000)::bigint
            - coalesce(paid.atomic, 0)
            - coalesce(refunded.atomic, 0)
        )
      end
    ), 0)::text as n
    from escrows e
    join bounties b on b.id = e.bounty_id
    left join lateral (
      select coalesce(sum((l.amount_usdc * 1000000)::bigint), 0) as atomic
      from allocation_ledger l
      where l.bounty_id = e.bounty_id
        and l.tx_hash is not null
        and length(trim(l.tx_hash)) > 0
        and l.kind in ('WINNER_PAYOUT', 'POOL_PAYOUT', 'FEE_OUT')
    ) paid on true
    left join lateral (
      select case
        when e.refund_tx_hash is not null and btrim(e.refund_tx_hash) <> ''
          then (e.amount_usdc * 1000000)::bigint
        else coalesce((
          select sum((c.amount_usdc * 1000000)::bigint)
          from bounty_contributions c
          where c.bounty_id = e.bounty_id
            and c.refund_tx_hash is not null
            and btrim(c.refund_tx_hash) <> ''
        ), 0)
      end as atomic
    ) refunded on true
    where b.deleted_at is null
      and (
        e.status in ('funded', 'settling', 'settled_partial')
        or (
          e.status in ('pending', 'failed')
          and (
            (e.x402_payment_id is not null and btrim(e.x402_payment_id) <> '')
            or (
              e.fund_tx_hash is not null
              and btrim(e.fund_tx_hash) <> ''
              and e.fund_tx_hash not like 'mock:%'
            )
          )
        )
      )
  `);
  return scalar(result);
}

/** Confirmed fee ledger (written when FEE_OUT settles). */
export async function feesEarnedAtomic(db: Database): Promise<bigint> {
  const result = await db.execute(sql`
    select coalesce(sum((fee_usdc * 1000000)::bigint), 0)::text as n
    from fee_ledger
  `);
  return scalar(result);
}

/** Successful admin fee withdrawals recorded in the audit log. */
export async function feesWithdrawnAtomic(db: Database): Promise<bigint> {
  const result = await db.execute(sql`
    select coalesce(sum(
      case
        when (after->>'amountAtomic') ~ '^[0-9]+$' then (after->>'amountAtomic')::bigint
        else 0
      end
    ), 0)::text as n
    from admin_audit_log
    where action = 'withdraw_fees'
      and result = 'ok'
  `);
  return scalar(result);
}

export async function readBalanceReport(
  db: Database,
  env: EnvMap,
  opts?: {
    client?: NamedAccountClient;
    readBalance?: (address: string) => Promise<bigint>;
    log?: (tile: string, reason: string) => void;
  },
): Promise<BalanceReport> {
  const readBalance = opts?.readBalance ?? ((address: string) => readOnChainUsdcBalance(address, env));
  return readBalanceTiles({
    network: readCdpNetwork(env),
    loadAccounts: async () => {
      const client = opts?.client ?? (await cdpNamedAccountClient());
      const accounts = await loadFeeAndEscrowAccounts(client, env);
      return { escrowAddress: accounts.escrowAddress, feeAddress: accounts.feeAddress };
    },
    feeAddressFallback: () => feeAddressFromEnv(env),
    readOnChain: readBalance,
    liabilities: () => expectedEscrowLiabilitiesAtomic(db),
    feesEarned: () => feesEarnedAtomic(db),
    feesWithdrawn: () => feesWithdrawnAtomic(db),
    log: opts?.log,
  });
}

export function balanceReportJson(report: BalanceReport) {
  return {
    network: report.network,
    escrow: {
      address: report.escrowAddress.address,
      addressError: report.escrowAddress.error,
      onChainUsdc: report.escrowOnChain.usdc,
      onChainError: report.escrowOnChain.error,
      liabilitiesUsdc: report.liabilities.usdc,
      liabilitiesError: report.liabilities.error,
      viewOnly: true,
    },
    fee: {
      address: report.feeAddress.address,
      addressError: report.feeAddress.error,
      onChainUsdc: report.feeOnChain.usdc,
      onChainError: report.feeOnChain.error,
      earnedUsdc: report.feesEarned.usdc,
      earnedError: report.feesEarned.error,
      withdrawnUsdc: report.feesWithdrawn.usdc,
      withdrawnError: report.feesWithdrawn.error,
    },
  };
}
