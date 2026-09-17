import { splitPostFeePool, usdcToAtomic } from "./money";

/**
 * V2-1 ledger invariant (ADR 0003): reuse `splitPostFeePool`.
 *
 * `|E|>0` → fee + winner + Σ pool shares = F
 * `|E|=0` → fee + winner = F (empty-pool regression)
 *
 * Overflow / excluded rows must have `share_usdc = 0` and do not appear as
 * `POOL_PAYOUT` legs. Winner share includes dust.
 */
export function frozenSetConservesFace(
  faceUsdc: string,
  participants: readonly { role: string; shareUsdc: string }[],
): {
  eligibleCount: number;
  feeUsdc: string;
  winnerUsdc: string;
  poolShares: string[];
  sumAtomic: bigint;
  faceAtomic: bigint;
} {
  const winner = participants.find((row) => row.role === "winner");
  if (!winner) {
    throw new Error("frozen set requires a winner row");
  }
  const pool = participants.filter((row) => row.role === "pool");
  const overflow = participants.filter((row) => row.role === "overflow");
  for (const row of participants) {
    if (
      (row.role === "overflow" ||
        row.role === "excluded_poster" ||
        row.role === "excluded_bot") &&
      usdcToAtomic(row.shareUsdc) !== 0n
    ) {
      throw new Error(`${row.role} share_usdc must be 0`);
    }
  }

  const eligibleCount = pool.length + overflow.length;
  const split = splitPostFeePool(faceUsdc, eligibleCount);
  const poolShares = pool.map((row) => row.shareUsdc);
  const poolSum = poolShares.reduce((acc, share) => acc + usdcToAtomic(share), 0n);
  const sumAtomic =
    usdcToAtomic(split.feeUsdc) + usdcToAtomic(winner.shareUsdc) + poolSum;

  if (usdcToAtomic(winner.shareUsdc) !== split.winnerAtomic) {
    throw new Error(
      `winner share ${winner.shareUsdc} != split ${split.winnerUsdc}`,
    );
  }
  if (eligibleCount === 0) {
    if (pool.length !== 0 || poolSum !== 0n) {
      throw new Error("empty pool must have no pool shares");
    }
  } else {
    for (const share of poolShares) {
      if (usdcToAtomic(share) !== split.shareAtomic) {
        throw new Error(`pool share ${share} != equal split ${split.eachUsdc}`);
      }
    }
    if (poolSum !== split.poolPaidAtomic) {
      throw new Error("Σ pool shares != N × each");
    }
  }
  if (sumAtomic !== split.faceAtomic) {
    throw new Error("fee + winner + Σ pool shares != face");
  }

  return {
    eligibleCount,
    feeUsdc: split.feeUsdc,
    winnerUsdc: split.winnerUsdc,
    poolShares,
    sumAtomic,
    faceAtomic: split.faceAtomic,
  };
}

export function ledgerConservesFace(
  faceUsdc: string,
  legs: readonly { kind: string; amountUsdc: string }[],
): void {
  const kinds = new Set(legs.map((leg) => leg.kind));
  if (!kinds.has("FEE_OUT") || !kinds.has("WINNER_PAYOUT")) {
    throw new Error("ledger requires FEE_OUT and WINNER_PAYOUT");
  }
  const poolLegs = legs.filter((leg) => leg.kind === "POOL_PAYOUT");
  const split = splitPostFeePool(faceUsdc, poolLegs.length);
  const sum = legs.reduce((acc, leg) => acc + usdcToAtomic(leg.amountUsdc), 0n);
  if (sum !== usdcToAtomic(faceUsdc)) {
    throw new Error("ledger sum != face");
  }
  const fee = legs.find((leg) => leg.kind === "FEE_OUT");
  const winner = legs.find((leg) => leg.kind === "WINNER_PAYOUT");
  if (fee == null || usdcToAtomic(fee.amountUsdc) !== split.feeAtomic) {
    throw new Error("FEE_OUT != split fee");
  }
  if (winner == null || usdcToAtomic(winner.amountUsdc) !== split.winnerAtomic) {
    throw new Error("WINNER_PAYOUT != split winner");
  }
}
