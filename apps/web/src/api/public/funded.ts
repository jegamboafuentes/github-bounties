import { sql } from "drizzle-orm";
import type { Database } from "../../db/client";
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
  return Boolean(fundTxHash && fundTxHash.trim().length > 0);
}

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

export function confirmedTotalFor(totals: ReadonlyMap<string, string>, bountyId: string): string {
  return totals.get(bountyId) ?? ZERO_FUNDED_USDC;
}

/**
 * Confirmed contribution sums for a page of bounties.
 * A database without `bounty_contributions` yields an empty map (every total is zero).
 * Does not select wallet addresses.
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
  try {
    const result = await db.execute(sql`
      select bounty_id, amount_usdc, fund_tx_hash
      from bounty_contributions
      where bounty_id in (${idList})
    `);
    return sumConfirmedContributionAmounts(contributionAmountsFromQuery(result));
  } catch (err) {
    if (!isUndefinedTableError(err)) throw err;
    console.error(
      JSON.stringify({ event: "public_funded_total_query_failed", error: "missing_table" }),
    );
    return new Map();
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
