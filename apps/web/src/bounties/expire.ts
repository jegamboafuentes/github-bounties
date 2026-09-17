import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, claimLocks } from "../db/schema";

export type ExpireClaimLocksResult = {
  expiredLockIds: string[];
  releasedLockIds: string[];
  restoredBountyIds: string[];
};

/**
 * V2-4 claim-lock sunset. Drain every residual exclusive `claim_locks` row
 * with `status=active` (overdue → `expired`, still-unexpired → `released`).
 * If the bounty is still `claim_locked`, restore it to `funded` (open).
 * Does not touch money rows or `bounties.expires_at` refunds.
 * Safe to call on every board/detail read and from the expiry cron.
 */
export async function expireClaimLocks(
  db: Database,
  now: Date = new Date(),
): Promise<ExpireClaimLocksResult> {
  return drainExclusiveClaimLocks(db, now);
}

/** Force-release / expire residual V1 exclusive locks. Alias of expireClaimLocks. */
export async function drainExclusiveClaimLocks(
  db: Database,
  now: Date = new Date(),
  bountyId?: string,
): Promise<ExpireClaimLocksResult> {
  const expiredLockIds: string[] = [];
  const releasedLockIds: string[] = [];
  const restoredBountyIds: string[] = [];

  const active = await db
    .select({
      id: claimLocks.id,
      bountyId: claimLocks.bountyId,
      expiresAt: claimLocks.expiresAt,
    })
    .from(claimLocks)
    .where(
      bountyId
        ? and(eq(claimLocks.status, "active"), eq(claimLocks.bountyId, bountyId))
        : eq(claimLocks.status, "active"),
    );

  if (active.length === 0) {
    return { expiredLockIds, releasedLockIds, restoredBountyIds };
  }

  await db.transaction(async (tx) => {
    for (const lock of active) {
      const nextStatus =
        lock.expiresAt.getTime() <= now.getTime() ? "expired" : "released";
      const [updated] = await tx
        .update(claimLocks)
        .set({ status: nextStatus, updatedAt: now })
        .where(and(eq(claimLocks.id, lock.id), eq(claimLocks.status, "active")))
        .returning({ id: claimLocks.id });
      if (!updated) continue;
      if (nextStatus === "expired") expiredLockIds.push(updated.id);
      else releasedLockIds.push(updated.id);

      const [restored] = await tx
        .update(bounties)
        .set({ status: "funded", updatedAt: now })
        .where(and(eq(bounties.id, lock.bountyId), eq(bounties.status, "claim_locked")))
        .returning({ id: bounties.id });
      if (restored) restoredBountyIds.push(restored.id);
    }
  });

  return { expiredLockIds, releasedLockIds, restoredBountyIds };
}

/** Drain residual exclusive locks for one bounty (board/detail hot path). */
export async function expireClaimLocksForBounty(
  bountyId: string,
  db: Database,
  now: Date = new Date(),
): Promise<ExpireClaimLocksResult> {
  return drainExclusiveClaimLocks(db, now, bountyId);
}
