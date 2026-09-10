import { createHash, randomUUID } from "node:crypto";
import type { MoneyKind } from "./state";

/**
 * Long-lived idempotency store (ADR 0001). CDP `X-Idempotency-Key` is only
 * ~24h; we persist our key on `escrows` / reuse a deterministic UUID per
 * `(bountyId, kind)` so retries never double-spend.
 */
export function moneyIdempotencyKey(bountyId: string, kind: MoneyKind): string {
  const hex = createHash("sha256").update(`gb-v1-5:${bountyId}:${kind}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export function newLedgerAttemptId(): string {
  return randomUUID();
}

export function isMockTxHash(txHash: string | null | undefined): boolean {
  return Boolean(txHash?.startsWith("mock:"));
}
