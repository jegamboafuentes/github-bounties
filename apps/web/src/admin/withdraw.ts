import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { EnvMap } from "../auth/env";
import type { Database } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { feeWithdrawals, withdrawConfirmTokens } from "../db/schema";
import { isMainnetNetwork } from "../escrow/env";
import { USDC_BASE_MAINNET, USDC_BASE_SEPOLIA } from "../lib/constants";
import { atomicToUsdc } from "../lib/money";
import { finishAdminAudit, insertAdminAudit } from "./audit";
import { AdminError, isAdminError } from "./errors";
import { loadFeeAndEscrowAccounts, type NamedAccountClient } from "./fee-account";
import {
  assertWithdrawDestination,
  assertWithdrawEnabled,
  assertWithinBalance,
  parseWithdrawAmountAtomic,
  pinnedWithdrawNetwork,
} from "./withdraw-guards";
import { hashWithdrawToken, issueWithdrawToken, readWithdrawToken } from "./withdraw-token";

export const WITHDRAW_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export const WITHDRAW_TOKEN_USED_MESSAGE =
  "This confirm token was already used. Preview the withdrawal again.";
export const WITHDRAW_IN_FLIGHT_MESSAGE =
  "A fee withdrawal is already in flight for this wallet. It was not sent again.";
export const WITHDRAW_DUPLICATE_RECENT_MESSAGE =
  "The same amount was sent to this destination in the last 10 minutes. Confirm sendAgain to send it again.";
export const WITHDRAW_OUTCOME_UNKNOWN_MESSAGE =
  "The fee transfer outcome is unknown, so it was not retried. Reconcile this wallet before withdrawing again.";

const INFLIGHT_INDEX = "fee_withdrawals_one_inflight_per_wallet_uidx";
const SEND_AUDITED = new Set(["fee_transfer_failed", "withdraw_outcome_unknown"]);
const UNKNOWN_SEND =
  /timeout|timed out|aborted|econnreset|etimedout|econnrefused|socket hang up|fetch failed|und_err|other side closed|network error|getaddrinfo|no transaction hash/i;

export type WithdrawPreview = {
  amountUsdc: string;
  destination: string;
  network: string;
  feeBalanceUsdc: string;
  confirmToken: string;
  expiresAt: string;
};

export type FeeTransferFailure = {
  status: "failed" | "unknown";
  code: "fee_transfer_failed" | "withdraw_outcome_unknown";
  message: string;
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

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (typeof err === "object" && err && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "Fee transfer failed.";
}

function constraintName(err: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = err;
  let message = "";
  for (let i = 0; i < 6 && current && !seen.has(current); i += 1) {
    seen.add(current);
    if (typeof current !== "object") break;
    const constraint = (current as { constraint?: unknown }).constraint;
    if (typeof constraint === "string" && constraint.trim()) return constraint;
    const text = (current as { message?: unknown }).message;
    if (typeof text === "string") message += `\n${text}`;
    current = (current as { cause?: unknown }).cause;
  }
  return /unique constraint "([^"]+)"/i.exec(message)?.[1] ?? "";
}

/**
 * A thrown transfer is a known rejection (mark failed) unless the transport
 * never told us whether the transaction was broadcast.
 */
export function classifyFeeTransferFailure(err: unknown): FeeTransferFailure {
  const message = errorMessage(err);
  if (UNKNOWN_SEND.test(message)) {
    return {
      status: "unknown",
      code: "withdraw_outcome_unknown",
      message: WITHDRAW_OUTCOME_UNKNOWN_MESSAGE,
    };
  }
  return { status: "failed", code: "fee_transfer_failed", message };
}

async function auditWithdrawRefusal(
  input: { db: Database; actorEmail: string; destination?: string | null; now?: Date },
  action: string,
  err: AdminError,
): Promise<void> {
  await insertAdminAudit(input.db, {
    actorEmail: input.actorEmail,
    action,
    target: input.destination?.trim() || null,
    after: { reason: err.code },
    result: "refused",
    now: input.now,
  });
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
  try {
    return await previewFeeWithdrawInner(input);
  } catch (err) {
    if (isAdminError(err)) await auditWithdrawRefusal(input, "withdraw_fees_preview", err);
    throw err;
  }
}

async function previewFeeWithdrawInner(input: {
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
  const adminEmail = input.actorEmail.trim().toLowerCase();
  const id = randomUUID();
  const issued = issueWithdrawToken(
    {
      id,
      amountAtomic: amountAtomic.toString(),
      destination,
      network,
      adminEmail,
    },
    tokenSecret(input.env),
    now.getTime(),
  );
  await input.db.insert(withdrawConfirmTokens).values({
    id,
    tokenHash: hashWithdrawToken(issued.token),
    amountAtomic: amountAtomic.toString(),
    destination,
    network,
    adminEmail,
    feeAddress: accounts.feeAddress,
    expiresAt: issued.expiresAt,
    createdAt: now,
  });
  const amountUsdc = atomicToUsdc(amountAtomic);
  await insertAdminAudit(input.db, {
    actorEmail: input.actorEmail,
    action: "withdraw_fees_preview",
    target: destination,
    after: { amountUsdc, amountAtomic: amountAtomic.toString(), network, tokenId: id },
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

type ClaimedWithdraw = {
  withdrawalId: string;
  auditId: string;
  idempotencyKey: string;
  amountAtomic: bigint;
  amountUsdc: string;
  destination: string;
  network: string;
};

async function claimFeeWithdraw(input: {
  db: Database;
  actorEmail: string;
  tokenHash: string;
  tokenId: string;
  amountAtomic: string;
  destination: string;
  network: string;
  feeAddress: string;
  sendAgain: boolean;
  now: Date;
}): Promise<ClaimedWithdraw> {
  const since = new Date(input.now.getTime() - WITHDRAW_DUPLICATE_WINDOW_MS);
  return input.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.feeAddress})::bigint)`);

    const [token] = await tx
      .select()
      .from(withdrawConfirmTokens)
      .where(eq(withdrawConfirmTokens.tokenHash, input.tokenHash))
      .limit(1);
    if (!token || token.id !== input.tokenId) {
      throw new AdminError(400, "confirm_token_invalid", "Confirm token is missing, altered, or expired.");
    }
    if (token.usedAt) {
      throw new AdminError(409, "withdraw_token_used", WITHDRAW_TOKEN_USED_MESSAGE);
    }
    if (token.expiresAt.getTime() <= input.now.getTime()) {
      throw new AdminError(400, "confirm_token_invalid", "Confirm token is missing, altered, or expired.");
    }
    if (
      token.adminEmail !== input.actorEmail ||
      token.destination !== input.destination ||
      token.amountAtomic !== input.amountAtomic ||
      token.network !== input.network ||
      token.feeAddress !== input.feeAddress
    ) {
      throw new AdminError(400, "confirm_token_invalid", "Confirm token is missing, altered, or expired.");
    }

    const [inflight] = await tx
      .select({ id: feeWithdrawals.id })
      .from(feeWithdrawals)
      .where(
        and(
          eq(feeWithdrawals.feeAddress, input.feeAddress),
          inArray(feeWithdrawals.status, ["pending", "unknown"]),
        ),
      )
      .limit(1);
    if (inflight) {
      throw new AdminError(409, "withdraw_in_flight", WITHDRAW_IN_FLIGHT_MESSAGE);
    }

    if (!input.sendAgain) {
      const [recent] = await tx
        .select({ id: feeWithdrawals.id })
        .from(feeWithdrawals)
        .where(
          and(
            eq(feeWithdrawals.feeAddress, input.feeAddress),
            eq(feeWithdrawals.destination, input.destination),
            eq(feeWithdrawals.amountAtomic, input.amountAtomic),
            eq(feeWithdrawals.network, input.network),
            eq(feeWithdrawals.status, "ok"),
            gt(feeWithdrawals.createdAt, since),
          ),
        )
        .limit(1);
      if (recent) {
        throw new AdminError(409, "withdraw_duplicate_recent", WITHDRAW_DUPLICATE_RECENT_MESSAGE);
      }
    }

    // Consume before the send. A second use matches zero rows.
    // UPDATE … SET used_at = now() WHERE token_hash = ? AND used_at IS NULL AND expires_at > now() RETURNING
    const consumed = await tx
      .update(withdrawConfirmTokens)
      .set({ usedAt: input.now })
      .where(
        and(
          eq(withdrawConfirmTokens.tokenHash, input.tokenHash),
          isNull(withdrawConfirmTokens.usedAt),
          gt(withdrawConfirmTokens.expiresAt, input.now),
        ),
      )
      .returning({ id: withdrawConfirmTokens.id });
    if (consumed.length !== 1) {
      throw new AdminError(409, "withdraw_token_used", WITHDRAW_TOKEN_USED_MESSAGE);
    }

    const idempotencyKey = token.id;
    const amountUsdc = atomicToUsdc(BigInt(input.amountAtomic));
    try {
      const [withdrawal] = await tx
        .insert(feeWithdrawals)
        .values({
          tokenId: token.id,
          idempotencyKey,
          feeAddress: input.feeAddress,
          destination: input.destination,
          amountAtomic: input.amountAtomic,
          network: input.network,
          status: "pending",
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: feeWithdrawals.id });
      if (!withdrawal) throw new Error("fee withdrawal insert returned no row");
      const auditId = await insertAdminAudit(tx as unknown as Database, {
        actorEmail: input.actorEmail,
        action: "withdraw_fees",
        target: input.destination,
        before: { amountUsdc, amountAtomic: input.amountAtomic, idempotencyKey, tokenId: token.id },
        network: input.network,
        result: "pending",
        now: input.now,
      });
      return {
        withdrawalId: withdrawal.id,
        auditId,
        idempotencyKey,
        amountAtomic: BigInt(input.amountAtomic),
        amountUsdc,
        destination: input.destination,
        network: input.network,
      };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const name = constraintName(err);
        if (name === INFLIGHT_INDEX || name.includes("inflight")) {
          throw new AdminError(409, "withdraw_in_flight", WITHDRAW_IN_FLIGHT_MESSAGE);
        }
        throw new AdminError(409, "withdraw_token_used", WITHDRAW_TOKEN_USED_MESSAGE);
      }
      throw err;
    }
  });
}

async function markWithdrawal(
  db: Database,
  id: string,
  patch: { status: "ok" | "failed" | "unknown"; txHash?: string | null; error?: string | null },
  now: Date,
): Promise<void> {
  await db
    .update(feeWithdrawals)
    .set({
      status: patch.status,
      txHash: patch.txHash ?? null,
      error: patch.error ?? null,
      updatedAt: now,
    })
    .where(eq(feeWithdrawals.id, id));
}

export async function executeFeeWithdraw(input: {
  db: Database;
  env: EnvMap;
  actorEmail: string;
  confirmToken: string;
  confirmation: string;
  callerNetwork?: string | null;
  /** Explicit repeat of the same amount and destination inside the 10-minute window. */
  sendAgain?: boolean;
  client: NamedAccountClient;
  readBalance: (address: string) => Promise<bigint>;
  now?: Date;
}): Promise<{ txHash: string; amountUsdc: string; destination: string; network: string }> {
  try {
    return await executeFeeWithdrawInner(input);
  } catch (err) {
    if (isAdminError(err) && !SEND_AUDITED.has(err.code)) {
      await auditWithdrawRefusal(input, "withdraw_fees", err);
    }
    throw err;
  }
}

async function executeFeeWithdrawInner(input: {
  db: Database;
  env: EnvMap;
  actorEmail: string;
  confirmToken: string;
  confirmation: string;
  callerNetwork?: string | null;
  sendAgain?: boolean;
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

  const claimed = await claimFeeWithdraw({
    db: input.db,
    actorEmail: actor,
    tokenHash: hashWithdrawToken(input.confirmToken),
    tokenId: claims.id,
    amountAtomic: claims.amountAtomic,
    destination,
    network,
    feeAddress: accounts.feeAddress,
    sendAgain: input.sendAgain === true,
    now,
  });

  try {
    // One send. Do not retry. A timeout stays `unknown` until the row is reconciled.
    const sent = await accounts.fee.transfer({
      to: destination,
      amount: amountAtomic,
      token: isMainnetNetwork(network) ? USDC_BASE_MAINNET : USDC_BASE_SEPOLIA,
      network: transferNetwork(network),
      idempotencyKey: claimed.idempotencyKey,
    });
    const txHash = sent.transactionHash?.trim() ?? "";
    if (!txHash) {
      await markWithdrawal(input.db, claimed.withdrawalId, {
        status: "unknown",
        error: WITHDRAW_OUTCOME_UNKNOWN_MESSAGE,
      }, now);
      await finishSendAudit(input.db, claimed, "unknown", null, WITHDRAW_OUTCOME_UNKNOWN_MESSAGE);
      throw new AdminError(502, "withdraw_outcome_unknown", WITHDRAW_OUTCOME_UNKNOWN_MESSAGE);
    }
    await markWithdrawal(input.db, claimed.withdrawalId, { status: "ok", txHash }, now);
    await finishSendAudit(input.db, claimed, "ok", txHash, null);
    return { txHash, amountUsdc: claimed.amountUsdc, destination, network };
  } catch (err) {
    if (isAdminError(err) && SEND_AUDITED.has(err.code)) throw err;
    const outcome = classifyFeeTransferFailure(err);
    await markWithdrawal(input.db, claimed.withdrawalId, {
      status: outcome.status,
      error: outcome.message,
    }, now);
    await finishSendAudit(input.db, claimed, outcome.status, null, outcome.message);
    throw new AdminError(502, outcome.code, outcome.message);
  }
}

async function finishSendAudit(
  db: Database,
  claimed: ClaimedWithdraw,
  result: string,
  txHash: string | null,
  error: string | null,
): Promise<void> {
  try {
    await finishAdminAudit(db, claimed.auditId, {
      result,
      txHash,
      after: {
        amountUsdc: claimed.amountUsdc,
        amountAtomic: claimed.amountAtomic.toString(),
        idempotencyKey: claimed.idempotencyKey,
        txHash,
        ...(error ? { error } : {}),
      },
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        event: "admin_action_failed",
        reason: err instanceof Error ? err.message : "audit update failed",
      }),
    );
  }
}
