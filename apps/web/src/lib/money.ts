import {
  FEE_BPS,
  POOL_BPS_OF_POST_FEE,
  POOL_MAX_PAID,
  USDC_DECIMALS,
} from "./constants";

const ZERO = BigInt(0);
const TEN = BigInt(10);
const BPS_DENOMINATOR = BigInt(10_000);

/**
 * Face-split used by FeeLedger. Matches ADR 0001:
 * `fee_atomic = floor(face * fee_bps / 10_000)`; hunter gets the remainder.
 * Fee is taken at settlement, never at fund. No CDP calls here.
 */
export function usdcToAtomic(usdc: string): bigint {
  const trimmed = usdc.trim();
  if (!trimmed) {
    throw new Error("USDC amount is empty");
  }
  const negative = trimmed.startsWith("-");
  const raw = negative ? trimmed.slice(1) : trimmed;
  const parts = raw.split(".");
  if (parts.length > 2) {
    throw new Error(`invalid USDC amount: ${usdc}`);
  }
  const whole = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  if (!/^\d+$/.test(whole) || (frac.length > 0 && !/^\d+$/.test(frac))) {
    throw new Error(`invalid USDC amount: ${usdc}`);
  }
  if (frac.length > USDC_DECIMALS) {
    throw new Error(`USDC amount has more than ${USDC_DECIMALS} decimals: ${usdc}`);
  }
  const fracPadded = frac.padEnd(USDC_DECIMALS, "0");
  const atomic =
    BigInt(whole) * TEN ** BigInt(USDC_DECIMALS) + BigInt(fracPadded || "0");
  return negative ? -atomic : atomic;
}

export function atomicToUsdc(atomic: bigint): string {
  const negative = atomic < ZERO;
  const abs = negative ? -atomic : atomic;
  const scale = TEN ** BigInt(USDC_DECIMALS);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(USDC_DECIMALS, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export type FaceSplit = {
  faceAtomic: bigint;
  feeAtomic: bigint;
  hunterAtomic: bigint;
  faceUsdc: string;
  feeUsdc: string;
  hunterUsdc: string;
  feeBps: number;
};

/**
 * ADR 0001 settlement split. Fee is taken at settlement, never at fund.
 * `fee_atomic = floor(face * fee_bps / 10_000)` (200 bps = 2%); hunter gets remainder.
 * Same as `floor(face * 2 / 100)` when fee_bps=200.
 */
export function splitFaceAtomic(faceAtomic: bigint, feeBps: number = FEE_BPS): FaceSplit {
  if (typeof faceAtomic !== "bigint") {
    throw new TypeError("faceAtomic must be bigint");
  }
  if (faceAtomic <= ZERO) {
    throw new RangeError("faceAtomic must be > 0");
  }
  if (!Number.isInteger(feeBps) || feeBps < 0) {
    throw new RangeError("feeBps must be a non-negative integer");
  }
  const feeAtomic = (faceAtomic * BigInt(feeBps)) / BPS_DENOMINATOR;
  const hunterAtomic = faceAtomic - feeAtomic;
  return {
    faceAtomic,
    feeAtomic,
    hunterAtomic,
    faceUsdc: atomicToUsdc(faceAtomic),
    feeUsdc: atomicToUsdc(feeAtomic),
    hunterUsdc: atomicToUsdc(hunterAtomic),
    feeBps,
  };
}

export function splitFaceUsdc(faceUsdc: string, feeBps: number = FEE_BPS): FaceSplit {
  return splitFaceAtomic(usdcToAtomic(faceUsdc), feeBps);
}

export function feeFromFaceUsdc(faceUsdc: string, feeBps: number = FEE_BPS): string {
  return splitFaceUsdc(faceUsdc, feeBps).feeUsdc;
}

/**
 * ADR 0003 / V2-0 post-fee 85/15 split. **Not wired to settleEscrow.**
 *
 * ```
 * fee_atomic    = floor(F × 200 / 10_000)                 // unchanged from V1
 * post_fee      = F − fee_atomic
 * pool_atomic   = |E| = 0 ? 0 : floor(post_fee × 1500 / 10_000)  // 15% of 98%
 * N             = min(|E|, 10)
 * share_atomic  = N = 0 ? 0 : floor(pool_atomic / N)
 * dust_atomic   = pool_atomic − share × N                 // → winner
 * winner_atomic = post_fee − N × share                    // 85% of 98%, plus dust
 * ```
 *
 * `poolTotal` / `poolPaidAtomic` is what actually leaves escrow to the pool
 * (`N × share`). The winner column includes dust so `fee + winner + N×each = F`.
 */
export type PostFeePoolSplit = {
  faceAtomic: bigint;
  feeAtomic: bigint;
  postFeeAtomic: bigint;
  /** 15% of post-fee when |E|>0, else 0. Before equal-split dust. */
  poolAtomic: bigint;
  /** What actually leaves escrow to the pool: N × share. */
  poolPaidAtomic: bigint;
  /** Winner receives post-fee − poolPaid (includes dust). */
  winnerAtomic: bigint;
  shareAtomic: bigint;
  dustAtomic: bigint;
  eligibleCount: number;
  paidCount: number;
  feeBps: number;
  poolBpsOfPostFee: number;
  faceUsdc: string;
  feeUsdc: string;
  winnerUsdc: string;
  poolTotalUsdc: string;
  eachUsdc: string | null;
  dustUsdc: string;
};

export function splitPostFeePoolAtomic(
  faceAtomic: bigint,
  eligibleCount: number,
  feeBps: number = FEE_BPS,
  poolBpsOfPostFee: number = POOL_BPS_OF_POST_FEE,
  maxPaid: number = POOL_MAX_PAID,
): PostFeePoolSplit {
  if (!Number.isInteger(eligibleCount) || eligibleCount < 0) {
    throw new RangeError("eligibleCount must be a non-negative integer");
  }
  if (!Number.isInteger(poolBpsOfPostFee) || poolBpsOfPostFee < 0) {
    throw new RangeError("poolBpsOfPostFee must be a non-negative integer");
  }
  if (!Number.isInteger(maxPaid) || maxPaid < 0) {
    throw new RangeError("maxPaid must be a non-negative integer");
  }

  const face = splitFaceAtomic(faceAtomic, feeBps);
  const postFeeAtomic = face.hunterAtomic;
  const poolAtomic =
    eligibleCount === 0
      ? ZERO
      : (postFeeAtomic * BigInt(poolBpsOfPostFee)) / BPS_DENOMINATOR;
  const paidCount = Math.min(eligibleCount, maxPaid);
  const shareAtomic = paidCount === 0 ? ZERO : poolAtomic / BigInt(paidCount);
  const poolPaidAtomic = shareAtomic * BigInt(paidCount);
  const dustAtomic = poolAtomic - poolPaidAtomic;
  const winnerAtomic = postFeeAtomic - poolPaidAtomic;

  return {
    faceAtomic: face.faceAtomic,
    feeAtomic: face.feeAtomic,
    postFeeAtomic,
    poolAtomic,
    poolPaidAtomic,
    winnerAtomic,
    shareAtomic,
    dustAtomic,
    eligibleCount,
    paidCount,
    feeBps: face.feeBps,
    poolBpsOfPostFee,
    faceUsdc: face.faceUsdc,
    feeUsdc: face.feeUsdc,
    winnerUsdc: atomicToUsdc(winnerAtomic),
    poolTotalUsdc: atomicToUsdc(poolPaidAtomic),
    eachUsdc: paidCount === 0 ? null : atomicToUsdc(shareAtomic),
    dustUsdc: atomicToUsdc(dustAtomic),
  };
}

export function splitPostFeePool(
  faceUsdc: string,
  eligibleCount: number,
  feeBps: number = FEE_BPS,
  poolBpsOfPostFee: number = POOL_BPS_OF_POST_FEE,
  maxPaid: number = POOL_MAX_PAID,
): PostFeePoolSplit {
  return splitPostFeePoolAtomic(
    usdcToAtomic(faceUsdc),
    eligibleCount,
    feeBps,
    poolBpsOfPostFee,
    maxPaid,
  );
}

export function claimLockExpiresAt(lockedAt: Date, hours = 72): Date {
  return new Date(lockedAt.getTime() + hours * 60 * 60 * 1000);
}
