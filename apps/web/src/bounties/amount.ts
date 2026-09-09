import { atomicToUsdc, usdcToAtomic } from "../lib/money";
import { BountyError } from "./errors";

/** Normalize a face amount to 6-decimal USDC. Rejects empty, zero, and negative. */
export function normalizeBountyAmountUsdc(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new BountyError("invalid_amount", "Enter a USDC amount greater than 0.");
  }
  try {
    const atomic = usdcToAtomic(trimmed);
    if (atomic <= BigInt(0)) {
      throw new BountyError("invalid_amount", "Bounty face must be greater than 0 USDC.");
    }
    return atomicToUsdc(atomic);
  } catch (err) {
    if (err instanceof BountyError) throw err;
    throw new BountyError("invalid_amount", "Enter a valid USDC amount (up to 6 decimal places).");
  }
}
