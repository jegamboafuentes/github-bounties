/** Face-amount chips on create-bounty. Lock page uses the stored face (not these). */
export const FUND_AMOUNT_PRESETS_USDC = [1, 5, 10, 50, 100] as const;

export type FundAmountPreset = (typeof FUND_AMOUNT_PRESETS_USDC)[number];

export function isFundAmountPreset(value: number): value is FundAmountPreset {
  return (FUND_AMOUNT_PRESETS_USDC as readonly number[]).includes(value);
}

/** Chip label, e.g. `1` → `$1`. */
export function fundPresetLabel(preset: FundAmountPreset): string {
  return `$${preset}`;
}

/**
 * True when the typed amount is exactly that chip (1 and 1.00 match).
 * Invalid / empty amounts match nothing.
 */
export function fundPresetMatchesAmount(preset: FundAmountPreset, rawAmount: string): boolean {
  const typed = rawAmount.trim();
  if (!typed) return false;
  const presetText = String(preset);
  if (typed === presetText) return true;
  const typedNum = Number(typed);
  return Number.isFinite(typedNum) && typedNum === preset;
}
