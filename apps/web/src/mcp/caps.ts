/** Display spend caps with two fraction digits. Ledger values stay at six. */
export function formatCapUsdc(amount: string): string {
  const trimmed = amount.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return amount;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return amount;
  return value.toFixed(2);
}

export function spendCapsLabel(perTxUsdc: string, dailyUsdc: string): string {
  return `${formatCapUsdc(perTxUsdc)} USDC per transaction and ${formatCapUsdc(dailyUsdc)} USDC per UTC day`;
}
