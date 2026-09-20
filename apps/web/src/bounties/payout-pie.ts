import { FEE_BPS } from "../lib/constants";
import { atomicToUsdc, splitPostFeePool, usdcToAtomic } from "../lib/money";
import { payoutShareLabels } from "./roster";

export const PAYOUT_PIE_KEYS = ["fee", "winner", "pool"] as const;

export type PayoutPieKey = (typeof PAYOUT_PIE_KEYS)[number];

export type PayoutPieSlice = {
  key: PayoutPieKey;
  /** Matches the payout-breakdown row caption (Fee / Winner / Pool). */
  label: string;
  amountUsdc: string;
  atomic: bigint;
  /** part / pie total in [0, 1]. Zero slices are omitted. */
  share: number;
};

export type PayoutPie = {
  id: "face" | "postFee";
  caption: string;
  totalAtomic: bigint;
  slices: PayoutPieSlice[];
};

export type PayoutPieBreakdownInput = {
  faceUsdc: string;
  feeUsdc: string;
  winnerUsdc: string;
  poolTotalUsdc: string;
  emptyPool: boolean;
  winnerShareLabel: string;
  poolShareLabel: string;
};

export type PayoutPieArc = {
  key: PayoutPieKey;
  startDeg: number;
  endDeg: number;
  sweepDeg: number;
};

function shareOf(part: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number(part) / Number(total);
}

function slice(
  key: PayoutPieKey,
  label: string,
  amountUsdc: string,
  totalAtomic: bigint,
): PayoutPieSlice | null {
  const atomic = usdcToAtomic(amountUsdc);
  if (atomic <= 0n || totalAtomic <= 0n) return null;
  return {
    key,
    label,
    amountUsdc,
    atomic,
    share: shareOf(atomic, totalAtomic),
  };
}

function pie(
  id: PayoutPie["id"],
  caption: string,
  totalUsdc: string,
  parts: Array<{ key: PayoutPieKey; label: string; amountUsdc: string }>,
): PayoutPie {
  const totalAtomic = usdcToAtomic(totalUsdc);
  const slices = parts
    .map((part) => slice(part.key, part.label, part.amountUsdc, totalAtomic))
    .filter((row): row is PayoutPieSlice => row != null);
  return { id, caption, totalAtomic, slices };
}

/**
 * Tiny-pie inputs from the same breakdown fields the bounty page already shows.
 * Does not re-split face — amounts must already be ADR 0003 / `splitPostFeePool`.
 */
export function payoutPiesFromBreakdown(breakdown: PayoutPieBreakdownInput): {
  face: PayoutPie;
  postFee: PayoutPie;
} {
  const feeLabel = `Fee (${FEE_BPS / 100}%)`;
  const winnerLabel = `Winner (${breakdown.winnerShareLabel})`;
  const poolLabel = `Pool (${breakdown.poolShareLabel})`;
  const postFeeUsdc = atomicToUsdc(
    usdcToAtomic(breakdown.winnerUsdc) + usdcToAtomic(breakdown.poolTotalUsdc),
  );

  return {
    face: pie("face", "Of face", breakdown.faceUsdc, [
      { key: "fee", label: feeLabel, amountUsdc: breakdown.feeUsdc },
      { key: "winner", label: winnerLabel, amountUsdc: breakdown.winnerUsdc },
      {
        key: "pool",
        label: poolLabel,
        amountUsdc: breakdown.emptyPool ? "0" : breakdown.poolTotalUsdc,
      },
    ]),
    postFee: pie("postFee", "Of post-fee", postFeeUsdc, [
      { key: "winner", label: winnerLabel, amountUsdc: breakdown.winnerUsdc },
      {
        key: "pool",
        label: poolLabel,
        amountUsdc: breakdown.emptyPool ? "0" : breakdown.poolTotalUsdc,
      },
    ]),
  };
}

/** Test / preview helper: same math as the roster breakdown (`splitPostFeePool`). */
export function payoutPiesFromFace(faceUsdc: string, eligibleCount: number) {
  const split = splitPostFeePool(faceUsdc, eligibleCount);
  const labels = payoutShareLabels(split);
  return payoutPiesFromBreakdown({
    faceUsdc: split.faceUsdc,
    feeUsdc: split.feeUsdc,
    winnerUsdc: split.winnerUsdc,
    poolTotalUsdc: split.poolTotalUsdc,
    emptyPool: split.eligibleCount === 0,
    winnerShareLabel: labels.winnerShareLabel,
    poolShareLabel: labels.poolShareLabel,
  });
}

/**
 * Start/end degrees for SVG slices. Last slice always closes at 360 so
 * rounding cannot leave a gap. Zero-amount keys are already omitted.
 */
export function pieSliceArcs(pie: PayoutPie): PayoutPieArc[] {
  const { slices, totalAtomic } = pie;
  if (slices.length === 0 || totalAtomic <= 0n) return [];
  let used = 0n;
  return slices.map((row, index) => {
    const startDeg = degreesFromAtomic(used, totalAtomic);
    used += row.atomic;
    const endDeg = index === slices.length - 1 ? 360 : degreesFromAtomic(used, totalAtomic);
    return {
      key: row.key,
      startDeg,
      endDeg,
      sweepDeg: Math.round((endDeg - startDeg) * 1000) / 1000,
    };
  });
}

function degreesFromAtomic(part: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number((part * 360_000n) / total) / 1000;
}

export function describePayoutPie(pie: PayoutPie): string {
  if (pie.slices.length === 0) return `${pie.caption}: no split`;
  const parts = pie.slices
    .map((slice) => `${slice.label} ${slice.amountUsdc} USDC`)
    .join(", ");
  return `${pie.caption}: ${parts}`;
}
