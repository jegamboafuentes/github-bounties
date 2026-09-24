import { INVALID_BASE_ADDRESS_MESSAGE, normalizeBaseAddress } from "../lib/address";
import { EscrowError } from "./errors";

/**
 * Every user payout or refund destination must be a Base address.
 * Fee transfers use the rail's gb-fee account and do not come through here.
 */
export function requireBasePayoutAddress(
  value: string | null | undefined,
  emptyCode: "missing_payout_address" | "missing_funder_address" = "missing_payout_address",
): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    throw new EscrowError(
      emptyCode,
      emptyCode === "missing_funder_address"
        ? "Funder address is required to refund. Refunds use the recorded payer, not a caller-supplied address."
        : "A Base payout address is required. The winner sets it on their own Claim.",
    );
  }
  try {
    return normalizeBaseAddress(trimmed);
  } catch {
    throw new EscrowError("invalid_payout_address", INVALID_BASE_ADDRESS_MESSAGE);
  }
}
