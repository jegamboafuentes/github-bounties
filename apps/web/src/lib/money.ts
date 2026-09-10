import { FEE_BPS, USDC_DECIMALS } from "./constants";

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

export function claimLockExpiresAt(lockedAt: Date, hours = 72): Date {
  return new Date(lockedAt.getTime() + hours * 60 * 60 * 1000);
}
