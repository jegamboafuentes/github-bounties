/**
 * Dry-run by default. Lists every bounty whose funding legs would fail the
 * live payout guard (cdp): a hash that is not an x402 payment id or an
 * `x402-topup:` line. A hash that already has an `x402-topup:` marker is not
 * at-risk and is not listed. The on-chain payer check runs only for unmarked
 * hashes.
 *
 * A leg is recordable only when the hash is a real transaction, it is not a
 * placeholder (`lock:`, `legacy-fund:`, pasted text), it is not used by
 * another bounty, and the receipt shows one configured-USDC Transfer to the
 * escrow address from the recorded payer for at least the recorded amount.
 *
 * `--apply` appends `x402-topup:<hash>` for recordable hashes only. It does
 * not change bounty status and it does not send USDC. Dry-run opens Postgres
 * read-only, including on PROD. `--apply` on mainnet also needs `--allow-prod`
 * and `LEGACY_FUND_RECONCILE_ALLOW_PROD=1`.
 *
 * CDP API keys are not required. `DATABASE_URL` is. Receipts use
 * `BASE_RPC_URL` when set, otherwise the public Base RPC for `CDP_NETWORK`.
 */
import postgres from "postgres";
import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { postgresConnectArgs } from "../../src/db/client";
import { loadDatabaseUrl } from "../../src/db/env";
import { loadDotenvFiles } from "../../src/db/load-dotenv";
import {
  applyGuardDecision,
  assessFundingLeg,
  bountyIsAtRisk,
  createLegacyChainReader,
  isReconcileMainnet,
  legacyRpcUrl,
  type FundingLegAssessment,
  type FundingLegRecord,
} from "../../src/escrow/legacy-funding";
import { withVerifiedTopUpHash } from "../../src/escrow/payout-guard";
import { resolveFundWalletRuntime } from "../../src/wallet/env";

type Sql = ReturnType<typeof postgres>;

type JoinedRow = {
  bounty_id: string;
  escrow_id: string;
  escrow_fund_tx_hash: string | null;
  escrow_amount_usdc: string;
  escrow_funder_address: string | null;
  escrow_address: string | null;
  x402_payment_id: string | null;
  contribution_id: string | null;
  contribution_fund_tx_hash: string | null;
  contribution_amount_usdc: string | null;
  contribution_funder_address: string | null;
};

type LoadedLeg = FundingLegRecord & { escrowId: string };

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

function parseArgs(argv: string[]): { apply: boolean; allowProdFlag: boolean } {
  let apply = false;
  let allowProdFlag = false;
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--allow-prod") {
      allowProdFlag = true;
      continue;
    }
    throw new Error(
      `Unknown argument: ${arg}. Usage: npm run security:reconcile-legacy-funding -- [--apply] [--allow-prod]`,
    );
  }
  return { apply, allowProdFlag };
}

async function openSql(readOnly: boolean): Promise<Sql> {
  const { url, options } = postgresConnectArgs(loadDatabaseUrl());
  const sql = postgres(url, {
    ...options,
    connection: readOnly ? { default_transaction_read_only: true } : {},
  });
  if (!readOnly) return sql;
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

function ownersFor(rows: JoinedRow[]): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  const add = (hash: string | null, bountyId: string) => {
    const key = hash?.trim().toLowerCase();
    if (!key) return;
    const set = owners.get(key) ?? new Set<string>();
    set.add(bountyId);
    owners.set(key, set);
  };
  for (const row of rows) {
    add(row.escrow_fund_tx_hash, row.bounty_id);
    add(row.contribution_fund_tx_hash, row.bounty_id);
  }
  return owners;
}

function legsFrom(rows: JoinedRow[]): LoadedLeg[] {
  const byBounty = new Map<string, JoinedRow[]>();
  for (const row of rows) {
    const group = byBounty.get(row.bounty_id) ?? [];
    group.push(row);
    byBounty.set(row.bounty_id, group);
  }
  const legs: LoadedLeg[] = [];
  for (const [bountyId, group] of byBounty) {
    const head = group[0];
    if (!head) continue;
    const contributions = group.filter((row) => row.contribution_id && row.contribution_fund_tx_hash);
    if (contributions.length > 0) {
      for (const row of contributions) {
        legs.push({
          bountyId,
          escrowId: row.escrow_id,
          source: "contribution",
          contributionId: row.contribution_id,
          hash: row.contribution_fund_tx_hash ?? "",
          amountUsdc: row.contribution_amount_usdc ?? "0.000000",
          payer: row.contribution_funder_address,
          escrowAddress: row.escrow_address,
          x402PaymentId: row.x402_payment_id,
          escrowFundTxHash: row.escrow_fund_tx_hash,
        });
      }
      continue;
    }
    if (!head.escrow_fund_tx_hash) continue;
    legs.push({
      bountyId,
      escrowId: head.escrow_id,
      source: "escrow",
      contributionId: null,
      hash: head.escrow_fund_tx_hash,
      amountUsdc: head.escrow_amount_usdc,
      payer: head.escrow_funder_address,
      escrowAddress: head.escrow_address,
      x402PaymentId: head.x402_payment_id,
      escrowFundTxHash: head.escrow_fund_tx_hash,
    });
  }
  return legs;
}

function line(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function assertRpcChain(): Promise<void> {
  const fund = resolveFundWalletRuntime(process.env);
  const client = createPublicClient({
    chain: fund.chainId === 8453 ? base : baseSepolia,
    transport: http(legacyRpcUrl(process.env, fund.chainId)),
  });
  const chainId = await client.getChainId();
  if (chainId !== fund.chainId) {
    throw new Error(`RPC chain id ${chainId} does not match configured network chain id ${fund.chainId}.`);
  }
}

async function main(): Promise<void> {
  const { apply, allowProdFlag } = parseArgs(process.argv.slice(2));
  loadDotenvFiles();
  const mainnet = isReconcileMainnet(process.env);
  const decision = applyGuardDecision({
    apply,
    mainnet,
    allowProdFlag,
    allowProdEnv: process.env.LEGACY_FUND_RECONCILE_ALLOW_PROD === "1",
  });
  if (!decision.ok) throw new Error(decision.message);

  const sql = await openSql(!apply);
  try {
    const rows = await sql<JoinedRow[]>`
      SELECT
        e.bounty_id,
        e.id AS escrow_id,
        e.fund_tx_hash AS escrow_fund_tx_hash,
        e.amount_usdc::text AS escrow_amount_usdc,
        e.funder_address AS escrow_funder_address,
        e.escrow_address,
        e.x402_payment_id,
        c.id AS contribution_id,
        c.fund_tx_hash AS contribution_fund_tx_hash,
        c.amount_usdc::text AS contribution_amount_usdc,
        c.funder_address AS contribution_funder_address
      FROM escrows e
      LEFT JOIN bounty_contributions c ON c.bounty_id = e.bounty_id
    `;
    const parsed = rows.map((row) => ({
      bounty_id: requireText(row.bounty_id, "bounty id"),
      escrow_id: requireText(row.escrow_id, "escrow id"),
      escrow_fund_tx_hash: text(row.escrow_fund_tx_hash),
      escrow_amount_usdc: requireText(row.escrow_amount_usdc, "escrow amount"),
      escrow_funder_address: text(row.escrow_funder_address),
      escrow_address: text(row.escrow_address),
      x402_payment_id: text(row.x402_payment_id),
      contribution_id: text(row.contribution_id),
      contribution_fund_tx_hash: text(row.contribution_fund_tx_hash),
      contribution_amount_usdc: text(row.contribution_amount_usdc),
      contribution_funder_address: text(row.contribution_funder_address),
    }));
    const owners = ownersFor(parsed);
    const legs = legsFrom(parsed);
    const fund = resolveFundWalletRuntime(process.env);
    const needsChain = legs.some((leg) => {
      const used = (owners.get(leg.hash.trim().toLowerCase())?.size ?? 0) > 1;
      const preview = assessFundingLeg({
        leg,
        railMode: "cdp",
        usedByOtherBounty: used,
        usdcContract: fund.usdc,
      });
      return preview.reason === "needs_chain_check";
    });
    if (needsChain) await assertRpcChain();
    const reader = createLegacyChainReader(process.env);
    const receipts = new Map<string, Awaited<ReturnType<typeof reader>>>();
    const assessed: FundingLegAssessment[] = [];
    for (const leg of legs) {
      const key = leg.hash.trim().toLowerCase();
      const used = (owners.get(key)?.size ?? 0) > 1;
      let receipt = null;
      const preview = assessFundingLeg({
        leg,
        railMode: "cdp",
        usedByOtherBounty: used,
        usdcContract: fund.usdc,
      });
      if (preview.reason === "needs_chain_check") {
        const cached = receipts.get(key);
        receipt = cached ?? (await reader(leg.hash));
        receipts.set(key, receipt);
      }
      assessed.push(
        assessFundingLeg({
          leg,
          railMode: "cdp",
          usedByOtherBounty: used,
          usdcContract: fund.usdc,
          receipt,
        }),
      );
    }

    const atRisk = assessed.filter((leg) => !leg.countsNow);
    atRisk.sort((a, b) => a.bountyId.localeCompare(b.bountyId) || a.hash.localeCompare(b.hash));
    for (const leg of atRisk) {
      line({
        event: "legacy_fund_at_risk",
        bountyId: leg.bountyId,
        source: leg.source,
        hash: leg.hash,
        reason: leg.reason,
        chainFrom: leg.chainFrom,
        recordable: leg.recordable,
        countsNow: leg.countsNow,
        apply,
      });
    }

    const paymentByEscrow = new Map<string, { escrowId: string; paymentId: string | null }>();
    for (const row of parsed) {
      if (!paymentByEscrow.has(row.bounty_id)) {
        paymentByEscrow.set(row.bounty_id, {
          escrowId: row.escrow_id,
          paymentId: row.x402_payment_id,
        });
      }
    }
    let recorded = 0;
    if (apply) {
      const writable = new Map<string, string>();
      for (const leg of atRisk) {
        if (!leg.recordable) continue;
        const current = paymentByEscrow.get(leg.bountyId);
        if (!current) continue;
        const next = withVerifiedTopUpHash(writable.get(current.escrowId) ?? current.paymentId, leg.hash);
        if (next === (writable.get(current.escrowId) ?? current.paymentId ?? "")) continue;
        writable.set(current.escrowId, next);
        recorded += 1;
        line({
          event: "legacy_fund_recorded",
          bountyId: leg.bountyId,
          hash: leg.hash.trim().toLowerCase(),
          apply: true,
        });
      }
      for (const [escrowId, paymentId] of writable) {
        await sql`
          UPDATE escrows
          SET x402_payment_id = ${paymentId}, updated_at = now()
          WHERE id = ${escrowId}
        `;
      }
    }

    const bountyIds = new Set(atRisk.map((leg) => leg.bountyId));
    console.error(
      `reconcile-legacy-funding: mode=${apply ? "apply" : "dry-run"} mainnet=${mainnet} at_risk_bounties=${bountyIds.size} at_risk_legs=${atRisk.length} recordable=${atRisk.filter((leg) => leg.recordable).length} recorded=${recorded} flagged=${[...bountyIds].filter((id) => bountyIsAtRisk(atRisk.filter((leg) => leg.bountyId === id))).length}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "reconcile-legacy-funding failed";
  console.error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://***"));
  process.exit(1);
});
