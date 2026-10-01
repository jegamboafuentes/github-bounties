import { sql } from "drizzle-orm";
import { createPublicClient, http, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { EnvMap } from "../auth/env";
import type { Database } from "../db/client";
import { isMainnetNetwork, readCdpNetwork } from "../escrow/env";
import { USDC_BASE_MAINNET, USDC_BASE_SEPOLIA } from "../lib/constants";
import { atomicToUsdc } from "../lib/money";
import type { NamedAccountClient } from "./fee-account";
import { loadFeeAndEscrowAccounts } from "./fee-account";

const BALANCE_OF = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

export type BalanceSnapshot = {
  network: string;
  escrowAddress: string;
  feeAddress: string;
  escrowOnChainAtomic: bigint;
  feeOnChainAtomic: bigint;
  escrowLiabilitiesAtomic: bigint;
  feesEarnedAtomic: bigint;
  feesWithdrawnAtomic: bigint;
  escrowOnChainUsdc: string;
  feeOnChainUsdc: string;
  escrowLiabilitiesUsdc: string;
  feesEarnedUsdc: string;
  feesWithdrawnUsdc: string;
};

function usdcFor(network: string): Address {
  return (isMainnetNetwork(network) ? USDC_BASE_MAINNET : USDC_BASE_SEPOLIA) as Address;
}

export function rpcUrlFor(env: EnvMap, network: string): string {
  const configured = env.BASE_RPC_URL?.trim();
  if (configured) return configured;
  return isMainnetNetwork(network) ? "https://mainnet.base.org" : "https://sepolia.base.org";
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

/** Face still owed from open escrows, minus confirmed outbound legs. Deleted bounties are excluded. */
export async function expectedEscrowLiabilitiesAtomic(db: Database): Promise<bigint> {
  const result = await db.execute(sql`
    select coalesce(sum(
      case
        when e.status in ('refunded', 'settled', 'failed', 'pending') then 0
        else greatest(
          0,
          (e.amount_usdc * 1000000)::bigint - coalesce(paid.atomic, 0)
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
        and l.kind in ('WINNER_PAYOUT', 'POOL_PAYOUT', 'FEE_OUT', 'REFUND_OUT')
    ) paid on true
    where b.deleted_at is null
      and e.status in ('funded', 'settling', 'settled_partial')
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

export async function readBalanceSnapshot(
  db: Database,
  client: NamedAccountClient,
  env: EnvMap,
  readBalance: (address: string) => Promise<bigint> = (address) => readOnChainUsdcBalance(address, env),
): Promise<BalanceSnapshot> {
  const network = readCdpNetwork(env);
  const accounts = await loadFeeAndEscrowAccounts(client, env);
  const [escrowOnChainAtomic, feeOnChainAtomic, escrowLiabilitiesAtomic, earned, withdrawn] =
    await Promise.all([
      readBalance(accounts.escrowAddress),
      readBalance(accounts.feeAddress),
      expectedEscrowLiabilitiesAtomic(db),
      feesEarnedAtomic(db),
      feesWithdrawnAtomic(db),
    ]);
  return {
    network,
    escrowAddress: accounts.escrowAddress,
    feeAddress: accounts.feeAddress,
    escrowOnChainAtomic,
    feeOnChainAtomic,
    escrowLiabilitiesAtomic,
    feesEarnedAtomic: earned,
    feesWithdrawnAtomic: withdrawn,
    escrowOnChainUsdc: atomicToUsdc(escrowOnChainAtomic),
    feeOnChainUsdc: atomicToUsdc(feeOnChainAtomic),
    escrowLiabilitiesUsdc: atomicToUsdc(escrowLiabilitiesAtomic),
    feesEarnedUsdc: atomicToUsdc(earned),
    feesWithdrawnUsdc: atomicToUsdc(withdrawn),
  };
}

export function balanceSnapshotJson(snapshot: BalanceSnapshot) {
  return {
    network: snapshot.network,
    escrow: {
      address: snapshot.escrowAddress,
      onChainUsdc: snapshot.escrowOnChainUsdc,
      liabilitiesUsdc: snapshot.escrowLiabilitiesUsdc,
      viewOnly: true,
    },
    fee: {
      address: snapshot.feeAddress,
      onChainUsdc: snapshot.feeOnChainUsdc,
      earnedUsdc: snapshot.feesEarnedUsdc,
      withdrawnUsdc: snapshot.feesWithdrawnUsdc,
    },
  };
}
