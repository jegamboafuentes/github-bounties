/** EVM / Base address: 0x + 40 hex chars. V1 is Base-only (no ENS, no Solana). */
const BASE_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const INVALID_BASE_ADDRESS_MESSAGE =
  "Enter a Base wallet address (0x followed by 40 hex characters).";

export function isBaseAddress(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  if (!BASE_ADDRESS_RE.test(trimmed)) return false;
  return trimmed.toLowerCase() !== ZERO_ADDRESS;
}

/**
 * Normalize a BYO Base payout address. Preserves the submitted checksum casing.
 * Rejects empty, wrong length, non-hex, ENS, and the zero address.
 */
export function normalizeBaseAddress(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!isBaseAddress(trimmed)) {
    throw new Error(INVALID_BASE_ADDRESS_MESSAGE);
  }
  return trimmed;
}
