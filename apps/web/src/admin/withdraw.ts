import { createHash } from "node:crypto";
import type { EnvMap } from "../auth/env";
import type { Database } from "../db/client";
import { isMainnetNetwork } from "../escrow/env";
import { USDC_BASE_MAINNET, USDC_BASE_SEPOLIA } from "../lib/constants";
import { atomicToUsdc } from "../lib/money";
import { finishAdminAudit, insertAdminAudit } from "./audit";
import { AdminError } from "./errors";
import { loadFeeAndEscrowAccounts, type NamedAccountClient } from "./fee-account";
import {
  assertWithdrawDestination,
  assertWithdrawEnabled,
  assertWithinBalance,
  parseWithdrawAmountAtomic,
  pinnedWithdrawNetwork,
} from "./withdraw-guards";
import { issueWithdrawToken, readWithdrawToken } from "./withdraw-token";

export type WithdrawPreview = {
  amountUsdc: string;
  destination: string;
  network: string;
  feeBalanceUsdc: string;
  confirmToken: string;
  expiresAt: string;
};

function tokenSecret(env: EnvMap): string {
  const secret = env.AUTH_SECRET?.trim() || env.ADMIN_WITHDRAW_TOKEN_SECRET?.trim() || "";
  if (secret.length < 16) {
    throw new AdminError(500, "withdraw_secret_missing", "Withdraw confirm tokens need AUTH_SECRET.");
  }
  return secret;
}

function transferNetwork(network: string): "base" | "base-sepolia" {
  return isMainnetNetwork(network) ? "base" : "base-sepolia";
}

export async function previewFeeWithdraw(input: {
  db: Database;
  env: EnvMap;
  actorEmail: string;
  amountUsdc: string;
  destination: string;
  callerNetwork?: string | null;
  client: NamedAccountClient;
  readBalance: (address: string) => Promise<bigint>;
  now?: Date;
}): Promise<WithdrawPreview> {
  assertWithdrawEnabled(input.env);
  const network = pinnedWithdrawNetwork(input.env, input.callerNetwork);
  const accounts = await loadFeeAndEscrowAccounts(input.client, input.env);
  const destination = assertWithdrawDestination(input.destination, [
    accounts.escrowAddress,
    accounts.feeAddress,
  ]);
  const amountAtomic = parseWithdrawAmountAtomic(input.amountUsdc);
  const balance = await input.readBalance(accounts.feeAddress);
  assertWithinBalance(amountAtomic, balance);
  const now = input.now ?? new Date();
  const issued = issueWithdrawToken(
    {
      amountAtomic: amountAtomic.toString(),
      destination,
      network,
      adminEmail: input.actorEmail.trim().toLowerCase(),
    },
    tokenSecret(input.env),
    now.getTime(),
  );
  const amountUsdc = atomicToUsdc(amountAtomic);
  await insertAdminAudit(input.db, {
    actorEmail: input.actorEmail,
    action: "withdraw_fees_preview",
    target: destination,
    after: { amountUsdc, amountAtomic: amountAtomic.toString(), network },
    network,
    result: "preview",
    now,
  });
  return {
    amountUsdc,
    destination,
    network,
    feeBalanceUsdc: atomicToUsdc(balance),
    confirmToken: issued.token,
    expiresAt: issued.expiresAt.toISOString(),
  };
}

export async function executeFeeWithdraw(input: {
  db: Database;
  env: EnvMap;
  actorEmail: string;
  confirmToken: string;
  confirmation: string;
  callerNetwork?: string | null;
  client: NamedAccountClient;
  readBalance: (address: string) => Promise<bigint>;
  now?: Date;
}): Promise<{ txHash: string; amountUsdc: string; destination: string; network: string }> {
  assertWithdrawEnabled(input.env);
  const now = input.now ?? new Date();
  const claims = readWithdrawToken(input.confirmToken, tokenSecret(input.env), now.getTime());
  if (!claims) {
    throw new AdminError(400, "confirm_token_invalid", "Confirm token is missing, altered, or expired.");
  }
  const actor = input.actorEmail.trim().toLowerCase();
  if (claims.adminEmail !== actor) {
    throw new AdminError(400, "confirm_token_invalid", "Confirm token is missing, altered, or expired.");
  }
  const network = pinnedWithdrawNetwork(input.env, input.callerNetwork);
  if (claims.network !== network) {
    throw new AdminError(400, "network_mismatch", "Fee withdraw uses the service network.");
  }
  const accounts = await loadFeeAndEscrowAccounts(input.client, input.env);
  const destination = assertWithdrawDestination(input.confirmation, [
    accounts.escrowAddress,
    accounts.feeAddress,
  ]);
  if (destination !== claims.destination) {
    throw new AdminError(400, "confirmation_mismatch", "Type the destination address to confirm.");
  }
  const amountAtomic = BigInt(claims.amountAtomic);
  if (amountAtomic <= BigInt(0)) {
    throw new AdminError(400, "invalid_amount", "Amount must be greater than zero.");
  }
  const balance = await input.readBalance(accounts.feeAddress);
  assertWithinBalance(amountAtomic, balance);
  if (!accounts.fee.transfer) {
    throw new AdminError(500, "fee_transfer_missing", "Fee account cannot transfer.");
  }
  const idempotencyKey = `admin-fee-${createHash("sha256").update(input.confirmToken).digest("hex").slice(0, 32)}`;
  const amountUsdc = atomicToUsdc(amountAtomic);
  const auditId = await insertAdminAudit(input.db, {
    actorEmail: actor,
    action: "withdraw_fees",
    target: destination,
    before: { amountUsdc, amountAtomic: amountAtomic.toString(), idempotencyKey },
    network,
    result: "pending",
    now,
  });
  try {
    const sent = await accounts.fee.transfer({
      to: destination,
      amount: amountAtomic,
      token: isMainnetNetwork(network) ? USDC_BASE_MAINNET : USDC_BASE_SEPOLIA,
      network: transferNetwork(network),
      idempotencyKey,
    });
    const txHash = sent.transactionHash?.trim() ?? "";
    if (!txHash) {
      throw new AdminError(502, "fee_transfer_failed", "Fee transfer returned no transaction hash.");
    }
    await finishAdminAudit(input.db, auditId, {
      result: "ok",
      txHash,
      after: { amountUsdc, amountAtomic: amountAtomic.toString(), idempotencyKey, txHash },
    });
    return { txHash, amountUsdc, destination, network };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fee transfer failed.";
    await finishAdminAudit(input.db, auditId, {
      result: "failed",
      txHash: null,
      after: { amountUsdc, amountAtomic: amountAtomic.toString(), idempotencyKey, error: message },
    });
    if (err instanceof AdminError) throw err;
    throw new AdminError(502, "fee_transfer_failed", message);
  }
}
