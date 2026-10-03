import { getAddress } from "viem";
import type { EnvMap } from "../auth/env";
import type { UsdcSendRequest } from "../escrow/builder-code";
import { CDP_ESCROW_ACCOUNT_NAME, CDP_FEE_ACCOUNT_NAME } from "../lib/constants";
import { AdminError } from "./errors";

export type NamedAccount = {
  address: string;
  sendTransaction?: (args: UsdcSendRequest) => Promise<{ transactionHash?: string }>;
};

/** Named lookup only. Callers pass getAccount, never a create-or-load helper. */
export type NamedAccountClient = {
  getAccount: (args: { name: string }) => Promise<NamedAccount>;
};

export function assertFeeAddress(actual: string, env: EnvMap): string {
  const expected = env.FEE_WALLET_ADDRESS?.trim() ?? "";
  if (!expected) {
    throw new AdminError(500, "fee_address_unconfigured", "FEE_WALLET_ADDRESS is not set.");
  }
  let expectedChecksum: string;
  let actualChecksum: string;
  try {
    expectedChecksum = getAddress(expected);
    actualChecksum = getAddress(actual);
  } catch {
    throw new AdminError(500, "fee_address_mismatch", "Fee account address does not match FEE_WALLET_ADDRESS.");
  }
  if (expectedChecksum !== actualChecksum) {
    throw new AdminError(500, "fee_address_mismatch", "Fee account address does not match FEE_WALLET_ADDRESS.");
  }
  return actualChecksum;
}

export async function loadFeeAndEscrowAccounts(
  client: NamedAccountClient,
  env: EnvMap,
): Promise<{ fee: NamedAccount; feeAddress: string; escrowAddress: string }> {
  const fee = await client.getAccount({ name: CDP_FEE_ACCOUNT_NAME });
  const escrow = await client.getAccount({ name: CDP_ESCROW_ACCOUNT_NAME });
  const feeAddress = assertFeeAddress(fee.address, env);
  let escrowAddress: string;
  try {
    escrowAddress = getAddress(escrow.address);
  } catch {
    throw new AdminError(500, "escrow_address_unreadable", "Escrow account address could not be read.");
  }
  return { fee, feeAddress, escrowAddress };
}

/** Production loader. Uses cdp.evm.getAccount only. */
export async function cdpNamedAccountClient(): Promise<NamedAccountClient> {
  const { CdpClient } = await import("@coinbase/cdp-sdk");
  const cdp = new CdpClient();
  return {
    getAccount: async (args) => {
      const account = await cdp.evm.getAccount(args);
      return {
        address: account.address,
        sendTransaction: account.sendTransaction.bind(account) as NamedAccount["sendTransaction"],
      };
    },
  };
}
