import { AdminError } from "./errors";

export const FEE_BPS_MIN = 0;
export const FEE_BPS_MAX = 1000;
export const POOL_BPS_MIN = 1000;
export const POOL_BPS_MAX = 2000;

export const FEE_PERCENT_RANGE = "Fee must be from 0.00% to 10.00%.";
export const POOL_PERCENT_RANGE = "Pool must be from 10.00% to 20.00%.";

/** 200 bps → "2.00". 1500 bps → "15.00". */
export function bpsToPercent(bps: number): string {
  const negative = bps < 0;
  const abs = Math.abs(Math.trunc(bps));
  return `${negative ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "2.00", "2%", 2, or 2.5 → basis points. More than two decimal places is rejected. */
export function percentToBps(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    const scaled = value * 100;
    const bps = Math.round(scaled);
    if (Math.abs(scaled - bps) > 1e-6) return null;
    return bps;
  }
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function assertFeeBps(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < FEE_BPS_MIN || value > FEE_BPS_MAX) {
    throw new AdminError(400, "invalid_fee_bps", FEE_PERCENT_RANGE);
  }
  return value;
}

export function assertPoolBps(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < POOL_BPS_MIN || value > POOL_BPS_MAX) {
    throw new AdminError(400, "invalid_pool_bps", POOL_PERCENT_RANGE);
  }
  return value;
}

export function assertFeePercent(value: unknown): number {
  const bps = percentToBps(value);
  if (bps === null || bps < FEE_BPS_MIN || bps > FEE_BPS_MAX) {
    throw new AdminError(400, "invalid_fee_bps", FEE_PERCENT_RANGE);
  }
  return bps;
}

export function assertPoolPercent(value: unknown): number {
  const bps = percentToBps(value);
  if (bps === null || bps < POOL_BPS_MIN || bps > POOL_BPS_MAX) {
    throw new AdminError(400, "invalid_pool_bps", POOL_PERCENT_RANGE);
  }
  return bps;
}

function present(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (typeof value === "number" && !Number.isFinite(value)) return false;
  return true;
}

export function resolveFeeBps(input: { feeBps?: unknown; feePercent?: unknown }): number {
  const hasBps = present(input.feeBps);
  const hasPercent = present(input.feePercent);
  if (!hasBps && !hasPercent) throw new AdminError(400, "invalid_fee_bps", FEE_PERCENT_RANGE);
  const fromPercent = hasPercent ? assertFeePercent(input.feePercent) : null;
  const fromBps = hasBps ? assertFeeBps(input.feeBps) : null;
  if (fromPercent !== null && fromBps !== null && fromPercent !== fromBps) {
    throw new AdminError(400, "invalid_fee_bps", `${FEE_PERCENT_RANGE} fee_bps and fee_percent do not match.`);
  }
  return (fromPercent ?? fromBps) as number;
}

export function resolvePoolBps(input: { poolBps?: unknown; poolPercent?: unknown }): number {
  const hasBps = present(input.poolBps);
  const hasPercent = present(input.poolPercent);
  if (!hasBps && !hasPercent) throw new AdminError(400, "invalid_pool_bps", POOL_PERCENT_RANGE);
  const fromPercent = hasPercent ? assertPoolPercent(input.poolPercent) : null;
  const fromBps = hasBps ? assertPoolBps(input.poolBps) : null;
  if (fromPercent !== null && fromBps !== null && fromPercent !== fromBps) {
    throw new AdminError(400, "invalid_pool_bps", `${POOL_PERCENT_RANGE} pool_bps and pool_percent do not match.`);
  }
  return (fromPercent ?? fromBps) as number;
}
