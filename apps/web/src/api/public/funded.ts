import { sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { normalizeFundTxHash } from "../../escrow/fund-hash";
import { isUndefinedTableError } from "../../intelligence/errors";
import { atomicToUsdc, usdcToAtomic } from "../../lib/money";

/** Wire format for a zero confirmed sum. Pending drafts use this, not the face. */
export const ZERO_FUNDED_USDC = "0.000000";

export type ContributionAmountRow = {
  bountyId: string;
  amountUsdc: string;
  /** Recorded when the contribution is confirmed. Blank or null is not confirmed. */
  fundTxHash: string | null;
};

export function isRecordedFundTx(fundTxHash: string | null | undefined): boolean {
  return normalizeFundTxHash(fundTxHash).length > 0;
}

export type EscrowFundRow = {
  bountyId: string;
  /** Running face. Top-ups rewrite this to the new face, so it is not added on top of contributions. */
  amountUsdc: string;
  fundTxHash: string | null;
};

/**
 * Sum of confirmed contributions per bounty.
 * A row counts when it has a recorded fund transaction. A later refund does
 * not remove it: cancelled and refunded bounties still report this sum, and
 * `status` says the money is not still locked.
 */
export function sumConfirmedContributionAmounts(
  rows: readonly ContributionAmountRow[],
): Map<string, string> {
  const atomic = new Map<string, bigint>();
  for (const row of rows) {
    if (!isRecordedFundTx(row.fundTxHash)) continue;
    const prev = atomic.get(row.bountyId) ?? 0n;
    atomic.set(row.bountyId, prev + usdcToAtomic(row.amountUsdc));
  }
  const out = new Map<string, string>();
  for (const [bountyId, total] of atomic) {
    out.set(bountyId, atomicToUsdc(total));
  }
  return out;
}

/**
 * Confirmed funded total per bounty.
 *
 * Add each confirmed contribution (a recorded fund hash) once. When the
 * escrow has a recorded `fund_tx_hash` that is not already on a contribution,
 * add only the part of `escrows.amount_usdc` those contributions do not
 * already cover. Crowdfunding stores the original Lock as a contribution
 * with the same hash, and a top-up rewrites the escrow amount to the new
 * face, so that hash and those top-ups are not counted twice. A legacy
 * lock has the hash and the face only on the escrow. The total is
 * `0.000000` when no verified inflow is recorded.
 */
export function sumConfirmedFundedAmounts(
  contributions: readonly ContributionAmountRow[],
  escrows: readonly EscrowFundRow[] = [],
): Map<string, string> {
  const atomic = new Map<string, bigint>();
  const hashes = new Map<string, Set<string>>();

  const addHash = (bountyId: string, fundTxHash: string | null | undefined): string | null => {
    const hash = normalizeFundTxHash(fundTxHash);
    if (!hash) return null;
    const seen = hashes.get(bountyId) ?? new Set<string>();
    if (seen.has(hash)) return null;
    seen.add(hash);
    hashes.set(bountyId, seen);
    return hash;
  };

  for (const row of contributions) {
    if (!addHash(row.bountyId, row.fundTxHash)) continue;
    const prev = atomic.get(row.bountyId) ?? 0n;
    atomic.set(row.bountyId, prev + usdcToAtomic(row.amountUsdc));
  }

  for (const escrow of escrows) {
    if (!addHash(escrow.bountyId, escrow.fundTxHash)) continue;
    const already = atomic.get(escrow.bountyId) ?? 0n;
    const face = usdcToAtomic(escrow.amountUsdc);
    const original = face > already ? face - already : 0n;
    atomic.set(escrow.bountyId, already + original);
  }

  const out = new Map<string, string>();
  for (const [bountyId, total] of atomic) {
    out.set(bountyId, atomicToUsdc(total));
  }
  return out;
}

export function confirmedTotalFor(totals: ReadonlyMap<string, string>, bountyId: string): string {
  return totals.get(bountyId) ?? ZERO_FUNDED_USDC;
}

/**
 * Confirmed funded totals for a page of bounties.
 * A missing `bounty_contributions` table still counts legacy escrow funds.
 * A missing `escrows` table still counts contributions. Does not select wallet addresses.
 */
export async function loadConfirmedFundedTotals(
  db: Database,
  bountyIds: readonly string[],
): Promise<Map<string, string>> {
  if (bountyIds.length === 0) return new Map();
  const idList = sql.join(
    bountyIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const [contributions, escrowFunds] = await Promise.all([
    loadAmountRows(db, sql`
      select bounty_id, amount_usdc, fund_tx_hash
      from bounty_contributions
      where bounty_id in (${idList})
    `),
    loadAmountRows(db, sql`
      select bounty_id, amount_usdc, fund_tx_hash
      from escrows
      where bounty_id in (${idList})
    `),
  ]);
  return sumConfirmedFundedAmounts(contributions, escrowFunds);
}

async function loadAmountRows(
  db: Database,
  query: ReturnType<typeof sql>,
): Promise<ContributionAmountRow[]> {
  try {
    const result = await db.execute(query);
    return contributionAmountsFromQuery(result);
  } catch (err) {
    if (!isUndefinedTableError(err)) throw err;
    console.error(
      JSON.stringify({ event: "public_funded_total_query_failed", error: "missing_table" }),
    );
    return [];
  }
}

export function contributionAmountsFromQuery(result: unknown): ContributionAmountRow[] {
  const parsed: ContributionAmountRow[] = [];
  for (const raw of rowsOf(result)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const bountyId = textField(row, "bounty_id");
    const amountUsdc = textField(row, "amount_usdc");
    if (!bountyId || !amountUsdc) continue;
    parsed.push({
      bountyId,
      amountUsdc,
      fundTxHash: textField(row, "fund_tx_hash"),
    });
  }
  return parsed;
}

function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

function textField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
