"use client";

import {
  FUND_AMOUNT_PRESETS_USDC,
  fundPresetLabel,
  fundPresetMatchesAmount,
  type FundAmountPreset,
} from "@/lib/fund-presets";

export function AmountPresetChips({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Amount presets
      </span>
      <div className="flex flex-wrap gap-2" role="group" aria-label="USDC amount presets">
        {FUND_AMOUNT_PRESETS_USDC.map((preset) => {
          const selected = fundPresetMatchesAmount(preset, value);
          return (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(String(preset as FundAmountPreset))}
              className={
                selected
                  ? "rounded-full bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }
            >
              {fundPresetLabel(preset)}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-zinc-500">
        One-tap {FUND_AMOUNT_PRESETS_USDC.map((n) => `$${n}`).join(" / ")} or type a custom face
        below. Lock later pays this exact face — chips do not change an existing bounty.
      </p>
    </div>
  );
}
