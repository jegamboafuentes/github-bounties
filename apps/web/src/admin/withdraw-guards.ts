import { getAddress } from "viem";
import type { EnvMap } from "../auth/env";
import { isMainnetAllowed, isMainnetNetwork, readCdpNetwork } from "../escrow/env";
import { usdcToAtomic } from "../lib/money";
import { AdminError } from "./errors";

const ZERO = "0x0000000000000000000000000000000000000000";

/** Only the exact flag enables a send. API_MONEY_ENABLED is a different switch. */
export function withdrawEnabled(env: EnvMap = process.env): boolean {
  return env.ADMIN_WITHDRAW_ENABLED === "1";
}

export function assertWithdrawEnabled(env: EnvMap = process.env): void {
  if (!withdrawEnabled(env)) {
    throw new AdminError(403, "withdraw_disabled", "Fee withdraw is disabled.");
  }
}

/** Service network only. A caller-supplied chain that differs is refused. */
export function pinnedWithdrawNetwork(env: EnvMap, callerNetwork?: string | null): string {
  const network = readCdpNetwork(env);
  if (isMainnetNetwork(network) && !isMainnetAllowed(env)) {
    throw new AdminError(403, "mainnet_not_allowed", "Mainnet fee withdraw requires CDP_ALLOW_MAINNET=1.");
  }
  const requested = callerNetwork?.trim();
  if (requested && requested.toLowerCase() !== network.toLowerCase()) {
    throw new AdminError(400, "network_mismatch", "Fee withdraw uses the service network.");
  }
  return network;
}

/** EIP-55 checksum required. Lowercase and bad mixed-case are refused. */
export function checksummedAddress(raw: string): string {
  const trimmed = raw.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw new AdminError(400, "invalid_destination", "Destination must be a checksummed address.");
  }
  let checksummed: string;
  try {
    checksummed = getAddress(trimmed);
  } catch {
    throw new AdminError(400, "invalid_destination", "Destination must be a checksummed address.");
  }
  if (trimmed !== checksummed) {
    throw new AdminError(400, "invalid_destination", "Destination must be a checksummed address.");
  }
  return checksummed;
}

export function assertWithdrawDestination(raw: string, blocked: readonly string[]): string {
  const destination = checksummedAddress(raw);
  const forbidden = new Set<string>([getAddress(ZERO)]);
  for (const address of blocked) {
    if (!address?.trim()) continue;
    try {
      forbidden.add(getAddress(address));
    } catch {
      forbidden.add(address.trim());
    }
  }
  if (forbidden.has(destination)) {
    throw new AdminError(
      400,
      "destination_refused",
      "Destination cannot be the escrow wallet, the fee wallet, or the zero address.",
    );
  }
  return destination;
}

export function parseWithdrawAmountAtomic(amountUsdc: string): bigint {
  let atomic: bigint;
  try {
    atomic = usdcToAtomic(amountUsdc);
  } catch {
    throw new AdminError(400, "invalid_amount", "Amount must be a positive USDC value.");
  }
  if (atomic <= BigInt(0)) {
    throw new AdminError(400, "invalid_amount", "Amount must be greater than zero.");
  }
  return atomic;
}

export function assertWithinBalance(amountAtomic: bigint, balanceAtomic: bigint): void {
  if (amountAtomic > balanceAtomic) {
    throw new AdminError(400, "insufficient_fee_balance", "Amount is above the on-chain fee balance.");
  }
}
