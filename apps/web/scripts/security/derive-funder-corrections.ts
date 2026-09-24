/**
 * Read-only proposal for two bookkeeping fixes:
 * - escrows.funder_address equal to the escrow wallet (x402 payTo)
 * - contribution hashes missing an `x402-topup:<hash>` line on x402_payment_id
 *
 * Reads Postgres and the configured chain's JSON-RPC. Prints SQL on stdout.
 * Does not execute UPDATE, INSERT, or DELETE. The session is read-only.
 * The printed script is wrapped in BEGIN / ROLLBACK.
 *
 * Sender addresses come from the USDC Transfer log. This file has no
 * hard-coded wallet. Chain and USDC come from CDP_NETWORK / CDP_ALLOW_MAINNET.
 * RPC comes from BASE_RPC_URL (Base mainnet on PROD, Base Sepolia on DEV).
 */
import postgres from "postgres";
import { createPublicClient, http, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { postgresConnectArgs } from "../../src/db/client";
import { loadDatabaseUrl } from "../../src/db/env";
import { loadDotenvFiles } from "../../src/db/load-dotenv";
import { usdcToAtomic } from "../../src/lib/money";
import { resolveFundWalletRuntime } from "../../src/wallet/env";
import {
  isChainTxHash,
  matchEscrowUsdcTransfer,
  type TxLog,
} from "./match-usdc-transfer";
import {
  contributionNeedsTopUpMarker,
  planMarkerUpdate,
  recordedCreditUsdc,
  renderCorrectionScript,
  type ChainStamp,
  type CitedEvidence,
  type FunderUpdate,
  type MarkerContribution,
  type MarkerUpdate,
  type Refusal,
} from "./render-corrections";

type Sql = ReturnType<typeof postgres>;

type ReceiptShape = {
  transactionHash: string;
  blockNumber: bigint;
  status: string;
  logs: readonly {
    address: string;
    topics: readonly string[];
    data: string;
    logIndex: number | null;
  }[];
};

type ReceiptClient = {
  getChainId(): Promise<number>;
  getTransactionReceipt(args: { hash: Hex }): Promise<ReceiptShape>;
};

type FunderRow = {
  id: string;
  bounty_id: string;
  funder_address: string;
  escrow_address: string;
  fund_tx_hash: string | null;
  amount_usdc: string;
  contribution_id: string | null;
  contribution_amount_usdc: string | null;
};

type MarkerRow = {
  contribution_id: string;
  bounty_id: string;
  fund_tx_hash: string;
  amount_usdc: string;
  escrow_id: string;
  escrow_fund_tx_hash: string | null;
  x402_payment_id: string | null;
  escrow_address: string | null;
};

type LoadedReceipt =
  | {
      ok: true;
      txHash: string;
      blockNumber: bigint;
      status: "success" | "reverted";
      logs: TxLog[];
    }
  | { ok: false; code: string; detail: string };

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

function requireText(value: unknown, label: string): string {
  const parsed = text(value);
  if (parsed == null) throw new Error(`Query returned a non-text ${label}.`);
  return parsed;
}

function parseFunderRow(row: Record<string, unknown>): FunderRow {
  return {
    id: requireText(row.id, "escrow id"),
    bounty_id: requireText(row.bounty_id, "bounty id"),
    funder_address: requireText(row.funder_address, "funder_address"),
    escrow_address: requireText(row.escrow_address, "escrow_address"),
    fund_tx_hash: text(row.fund_tx_hash),
    amount_usdc: requireText(row.amount_usdc, "amount_usdc"),
    contribution_id: text(row.contribution_id),
    contribution_amount_usdc: text(row.contribution_amount_usdc),
  };
}

function parseMarkerRow(row: Record<string, unknown>): MarkerRow {
  return {
    contribution_id: requireText(row.contribution_id, "contribution id"),
    bounty_id: requireText(row.bounty_id, "bounty id"),
    fund_tx_hash: requireText(row.fund_tx_hash, "fund_tx_hash"),
    amount_usdc: requireText(row.amount_usdc, "amount_usdc"),
    escrow_id: requireText(row.escrow_id, "escrow id"),
    escrow_fund_tx_hash: text(row.escrow_fund_tx_hash),
    x402_payment_id: text(row.x402_payment_id),
    escrow_address: text(row.escrow_address),
  };
}

async function openReadOnlySql(): Promise<Sql> {
  const { url, options } = postgresConnectArgs(loadDatabaseUrl());
  const sql = postgres(url, {
    ...options,
    connection: {
      default_transaction_read_only: true,
    },
  });
  await sql`SET default_transaction_read_only = on`;
  const [setting] = await sql<{ default_transaction_read_only: string }[]>`
    SELECT current_setting('default_transaction_read_only') AS default_transaction_read_only
  `;
  if (setting?.default_transaction_read_only !== "on") {
    await sql.end({ timeout: 5 });
    throw new Error("Refusing to continue: Postgres session is not read-only.");
  }
  return sql;
}

function openRpc(chainId: number, rpcUrl: string): ReceiptClient {
  const rpc = createPublicClient({
    chain: chainId === 8453 ? base : baseSepolia,
    transport: http(rpcUrl),
  });
  return {
    getChainId: () => rpc.getChainId(),
    getTransactionReceipt: async (args) => {
      const receipt = await rpc.getTransactionReceipt(args);
      return {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        logs: receipt.logs.map((log) => ({
          address: log.address,
          topics: [...log.topics],
          data: log.data,
          logIndex: log.logIndex,
        })),
      };
    },
  };
}

function readRpcUrl(): string {
  const raw = process.env.BASE_RPC_URL?.trim() ?? "";
  if (!raw) {
    throw new Error(
      "BASE_RPC_URL is not set. PROD needs a Base mainnet JSON-RPC (chain id 8453). DEV needs a Base Sepolia JSON-RPC (chain id 84532).",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("BASE_RPC_URL is not a URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("BASE_RPC_URL must be an http(s) JSON-RPC URL.");
  }
  return raw;
}

function chainStamp(): ChainStamp & { rpcUrl: string } {
  const runtime = resolveFundWalletRuntime(process.env);
  return {
    chainId: runtime.chainId,
    chainName: runtime.chainName,
    usdcContract: runtime.usdc,
    network: runtime.network,
    rpcUrl: readRpcUrl(),
  };
}

async function assertRpcChain(client: ReceiptClient, expected: number, chainName: string): Promise<void> {
  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch {
    throw new Error("BASE_RPC_URL did not answer eth_chainId.");
  }
  if (chainId !== expected) {
    throw new Error(
      `RPC chain id ${chainId} does not match configured ${chainName} (${expected}). Refusing to derive corrections.`,
    );
  }
}

async function loadReceipt(client: ReceiptClient, hash: string): Promise<LoadedReceipt> {
  let receipt: ReceiptShape;
  try {
    receipt = await client.getTransactionReceipt({ hash: hash as Hex });
  } catch {
    return {
      ok: false,
      code: "receipt_not_found",
      detail: "No transaction receipt for the recorded fund tx on the configured chain.",
    };
  }
  if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
    return {
      ok: false,
      code: "receipt_hash_mismatch",
      detail: "Receipt transaction hash does not match the recorded fund tx.",
    };
  }
  if (receipt.status !== "success" && receipt.status !== "reverted") {
    return {
      ok: false,
      code: "unexpected_receipt_status",
      detail: "Receipt status was neither success nor reverted.",
    };
  }
  const logs: TxLog[] = [];
  for (const log of receipt.logs) {
    if (log.logIndex == null) {
      return {
        ok: false,
        code: "incomplete_receipt",
        detail: "Receipt log is missing logIndex.",
      };
    }
    logs.push({
      address: log.address,
      topics: log.topics,
      data: log.data,
      logIndex: log.logIndex,
    });
  }
  return {
    ok: true,
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    logs,
  };
}

function cite(receipt: Extract<LoadedReceipt, { ok: true }>, evidence: {
  logIndex: number;
  contract: string;
  from: string;
  to: string;
  amountAtomic: bigint;
}): CitedEvidence {
  return {
    ...evidence,
    txHash: receipt.txHash,
    blockNumber: receipt.blockNumber,
  };
}

function refusal(input: {
  kind: Refusal["kind"];
  bountyId: string;
  escrowId: string;
  txHash: string | null;
  code: string;
  detail: string;
}): Refusal {
  return input;
}

async function verifyFunderRow(
  row: FunderRow,
  load: (hash: string) => Promise<LoadedReceipt>,
  usdcContract: string,
): Promise<{ update?: FunderUpdate; refusal?: Refusal }> {
  const baseRefusal = {
    kind: "funder_address" as const,
    bountyId: row.bounty_id,
    escrowId: row.id,
    txHash: row.fund_tx_hash,
  };
  if (!isChainTxHash(row.fund_tx_hash)) {
    return {
      refusal: refusal({
        ...baseRefusal,
        code: "not_a_chain_hash",
        detail: "Recorded fund tx is not a 32-byte hash, so no receipt was fetched.",
      }),
    };
  }
  const credit = recordedCreditUsdc(row.contribution_amount_usdc, row.amount_usdc);
  let amountAtomic: bigint;
  try {
    amountAtomic = usdcToAtomic(credit.usdc);
  } catch (err) {
    return {
      refusal: refusal({
        ...baseRefusal,
        code: "invalid_amount",
        detail: err instanceof Error ? err.message : "Recorded amount is invalid.",
      }),
    };
  }
  const receipt = await load(row.fund_tx_hash);
  if (!receipt.ok) {
    return { refusal: refusal({ ...baseRefusal, code: receipt.code, detail: receipt.detail }) };
  }
  const matched = matchEscrowUsdcTransfer({
    logs: receipt.logs,
    usdcContract,
    escrowWallet: row.escrow_address,
    amountAtomic,
    receiptStatus: receipt.status,
  });
  if (!matched.ok) {
    return {
      refusal: refusal({
        ...baseRefusal,
        code: matched.code,
        detail: matched.detail,
      }),
    };
  }
  return {
    update: {
      escrowId: row.id,
      bountyId: row.bounty_id,
      fundTxHash: row.fund_tx_hash,
      funderAddress: matched.evidence.from,
      escrowAddress: matched.evidence.to,
      amountSource: credit.source,
      evidence: cite(receipt, matched.evidence),
    },
  };
}

async function verifyMarkerRow(
  row: MarkerRow,
  load: (hash: string) => Promise<LoadedReceipt>,
  usdcContract: string,
): Promise<{ contribution?: MarkerContribution; refusal?: Refusal; paymentId: string | null }> {
  const baseRefusal = {
    kind: "x402_topup_marker" as const,
    bountyId: row.bounty_id,
    escrowId: row.escrow_id,
    txHash: row.fund_tx_hash,
  };
  if (!row.escrow_address?.trim()) {
    return {
      paymentId: row.x402_payment_id,
      refusal: refusal({
        ...baseRefusal,
        code: "invalid_escrow_address",
        detail: "escrow_address is empty.",
      }),
    };
  }
  if (!isChainTxHash(row.fund_tx_hash)) {
    return {
      paymentId: row.x402_payment_id,
      refusal: refusal({
        ...baseRefusal,
        code: "not_a_chain_hash",
        detail: "Contribution fund tx is not a 32-byte hash, so no receipt was fetched.",
      }),
    };
  }
  let amountAtomic: bigint;
  try {
    amountAtomic = usdcToAtomic(row.amount_usdc);
  } catch (err) {
    return {
      paymentId: row.x402_payment_id,
      refusal: refusal({
        ...baseRefusal,
        code: "invalid_amount",
        detail: err instanceof Error ? err.message : "Recorded amount is invalid.",
      }),
    };
  }
  const receipt = await load(row.fund_tx_hash);
  if (!receipt.ok) {
    return {
      paymentId: row.x402_payment_id,
      refusal: refusal({ ...baseRefusal, code: receipt.code, detail: receipt.detail }),
    };
  }
  const matched = matchEscrowUsdcTransfer({
    logs: receipt.logs,
    usdcContract,
    escrowWallet: row.escrow_address,
    amountAtomic,
    receiptStatus: receipt.status,
  });
  if (!matched.ok) {
    return {
      paymentId: row.x402_payment_id,
      refusal: refusal({ ...baseRefusal, code: matched.code, detail: matched.detail }),
    };
  }
  if (!row.x402_payment_id?.trim()) {
    return {
      paymentId: row.x402_payment_id,
      refusal: refusal({
        ...baseRefusal,
        code: "missing_payment_id",
        detail:
          "Contribution tx matched on-chain, but escrows.x402_payment_id is empty. Refusing to invent a payment id. Append x402-topup only to an existing id.",
      }),
    };
  }
  return {
    paymentId: row.x402_payment_id,
    contribution: {
      contributionId: row.contribution_id,
      fundTxHash: row.fund_tx_hash.trim(),
      evidence: cite(receipt, matched.evidence),
    },
  };
}

function dedupeFunderRows(rows: FunderRow[]): { rows: FunderRow[]; refusals: Refusal[] } {
  const groups = new Map<string, FunderRow[]>();
  for (const row of rows) {
    const list = groups.get(row.id) ?? [];
    list.push(row);
    groups.set(row.id, list);
  }
  const kept: FunderRow[] = [];
  const refusals: Refusal[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const amounts = new Set(group.map((row) => row.contribution_amount_usdc?.trim() ?? ""));
    if (group.length > 1 && amounts.size > 1) {
      refusals.push({
        kind: "funder_address",
        bountyId: first.bounty_id,
        escrowId: first.id,
        txHash: first.fund_tx_hash,
        code: "ambiguous_amount",
        detail: "More than one contribution amount is stored for this fund tx. No UPDATE.",
      });
      continue;
    }
    kept.push(first);
  }
  return { rows: kept, refusals };
}

export async function deriveCorrections(sql: Sql, client: ReceiptClient, chain: ChainStamp): Promise<string> {
  const funderRaw = await sql<Record<string, unknown>[]>`
    SELECT
      e.id,
      e.bounty_id,
      e.funder_address,
      e.escrow_address,
      e.fund_tx_hash,
      e.amount_usdc,
      c.id AS contribution_id,
      c.amount_usdc AS contribution_amount_usdc
    FROM escrows e
    LEFT JOIN bounty_contributions c
      ON c.bounty_id = e.bounty_id
     AND lower(btrim(c.fund_tx_hash)) = lower(btrim(e.fund_tx_hash))
    WHERE e.funder_address IS NOT NULL
      AND e.escrow_address IS NOT NULL
      AND lower(btrim(e.funder_address)) = lower(btrim(e.escrow_address))
  `;
  const markerRaw = await sql<Record<string, unknown>[]>`
    SELECT
      c.id AS contribution_id,
      c.bounty_id,
      c.fund_tx_hash,
      c.amount_usdc,
      e.id AS escrow_id,
      e.fund_tx_hash AS escrow_fund_tx_hash,
      e.x402_payment_id,
      e.escrow_address
    FROM bounty_contributions c
    JOIN escrows e ON e.bounty_id = c.bounty_id
    WHERE c.fund_tx_hash NOT LIKE 'mock:%'
      AND c.fund_tx_hash NOT LIKE 'sepolia-dry-run:%'
  `;

  const funderParsed = dedupeFunderRows(funderRaw.map(parseFunderRow));
  const markerRows = markerRaw
    .map(parseMarkerRow)
    .filter((row) =>
      contributionNeedsTopUpMarker({
        contributionFundTxHash: row.fund_tx_hash,
        escrowFundTxHash: row.escrow_fund_tx_hash,
        x402PaymentId: row.x402_payment_id,
      }),
    );

  const cache = new Map<string, LoadedReceipt>();
  const load = async (hash: string): Promise<LoadedReceipt> => {
    const key = hash.toLowerCase();
    const cached = cache.get(key);
    if (cached) return cached;
    const loaded = await loadReceipt(client, hash);
    cache.set(key, loaded);
    return loaded;
  };

  const refusals: Refusal[] = [...funderParsed.refusals];
  const funderUpdates: FunderUpdate[] = [];
  for (const row of funderParsed.rows) {
    const result = await verifyFunderRow(row, load, chain.usdcContract);
    if (result.update) funderUpdates.push(result.update);
    if (result.refusal) refusals.push(result.refusal);
  }

  const markerGroups = new Map<
    string,
    { bountyId: string; paymentId: string; contributions: MarkerContribution[] }
  >();
  const markerBlocked = new Set<string>();
  for (const row of markerRows) {
    const result = await verifyMarkerRow(row, load, chain.usdcContract);
    if (result.refusal) {
      refusals.push(result.refusal);
      continue;
    }
    if (!result.contribution || !result.paymentId?.trim()) continue;
    if (markerBlocked.has(row.escrow_id)) {
      refusals.push({
        kind: "x402_topup_marker",
        bountyId: row.bounty_id,
        escrowId: row.escrow_id,
        txHash: row.fund_tx_hash,
        code: "payment_id_conflict",
        detail: "Contributions on this escrow disagree about x402_payment_id. No marker UPDATE.",
      });
      continue;
    }
    const group = markerGroups.get(row.escrow_id);
    if (group && group.paymentId !== result.paymentId) {
      refusals.push({
        kind: "x402_topup_marker",
        bountyId: row.bounty_id,
        escrowId: row.escrow_id,
        txHash: row.fund_tx_hash,
        code: "payment_id_conflict",
        detail: "Contributions on this escrow disagree about x402_payment_id. No marker UPDATE.",
      });
      markerGroups.delete(row.escrow_id);
      markerBlocked.add(row.escrow_id);
      continue;
    }
    const next = group ?? {
      bountyId: row.bounty_id,
      paymentId: result.paymentId,
      contributions: [],
    };
    next.contributions.push(result.contribution);
    markerGroups.set(row.escrow_id, next);
  }

  const markerUpdates: MarkerUpdate[] = [];
  for (const [escrowId, group] of markerGroups) {
    if (group.contributions.length === 0) continue;
    markerUpdates.push(
      planMarkerUpdate({
        escrowId,
        bountyId: group.bountyId,
        previousPaymentId: group.paymentId,
        contributions: group.contributions,
      }),
    );
  }

  console.error(
    `derive-funder-corrections: chain_id=${chain.chainId} usdc=${chain.usdcContract} funder_rows=${funderParsed.rows.length} marker_rows=${markerRows.length} updates=${funderUpdates.length + markerUpdates.length} refusals=${refusals.length}`,
  );
  return renderCorrectionScript({
    chain,
    funderUpdates,
    markerUpdates,
    refusals,
  });
}

async function main(): Promise<void> {
  const extra = process.argv.slice(2).filter((arg) => arg !== "--");
  if (extra.length > 0) {
    throw new Error(
      `Unknown argument: ${extra[0]}. This tool takes no address arguments and does not write. Run it with PROD or DEV env only.`,
    );
  }
  loadDotenvFiles();
  const chain = chainStamp();
  let client: ReceiptClient;
  try {
    client = openRpc(chain.chainId, chain.rpcUrl);
  } catch {
    throw new Error("Could not open BASE_RPC_URL.");
  }
  await assertRpcChain(client, chain.chainId, chain.chainName);
  const sql = await openReadOnlySql();
  try {
    const script = await deriveCorrections(sql, client, chain);
    process.stdout.write(script);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "derive-funder-corrections failed";
  console.error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://***"));
  process.exit(1);
});
