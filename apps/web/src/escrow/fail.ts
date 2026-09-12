import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { escrows } from "../db/schema";
import { EscrowError } from "./errors";

/** Unfunded cancel/expiry — `escrows.status=failed`, no USDC movement. */
export const VOIDED_UNFUNDED_CODE = "voided_unfunded";
export const VOIDED_UNFUNDED_REASON =
  "No FUND_IN confirmed — cancel/expiry voids the draft. No USDC movement.";

export type PersistedLockFailure = {
  code: string;
  reason: string;
  error: EscrowError;
};

/**
 * Normalize a Lock/rail throw into a stable code + human-readable reason.
 * Unknown errors become `rail_failed` so dogfood never sees a blank reason.
 */
export function toPersistedLockFailure(err: unknown): PersistedLockFailure {
  if (err instanceof EscrowError) {
    return { code: err.code, reason: err.message, error: err };
  }
  const error = new EscrowError(
    "rail_failed",
    err instanceof Error && err.message.trim()
      ? err.message
      : "Lock rail failed.",
  );
  return { code: error.code, reason: error.message, error };
}

export function formatEscrowFailLabel(
  failCode: string | null | undefined,
  failReason: string | null | undefined,
): string | null {
  const code = failCode?.trim() || "";
  const reason = failReason?.trim() || "";
  if (!code && !reason) return null;
  if (code && reason) return `${code} · ${reason}`;
  return code || reason;
}

export async function persistEscrowFail(
  db: Database,
  bountyId: string,
  input: { code: string; reason: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .update(escrows)
    .set({
      failCode: input.code,
      failReason: input.reason,
      updatedAt: now,
    })
    .where(eq(escrows.bountyId, bountyId));
}
