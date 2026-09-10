import { and, eq, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, claimLocks } from "../db/schema";

export type ExpireClaimLocksResult = {
  expiredLockIds: string[];
  restoredBountyIds: string[];
};

/**
 * Cron-friendly: expire active locks whose deadline has passed.
 * If the bounty is still `claim_locked`, restore it to `funded` (open).
 * Does not touch money rows. Safe to call on every board/claim request.
 */
export async function expireClaimLocks(
  db: Database,
  now: Date = new Date(),
): Promise<ExpireClaimLocksResult> {
  const expiredLockIds: string[] = [];
  const restoredBountyIds: string[] = [];

  const overdue = await db
    .select({
      id: claimLocks.id,
      bountyId: claimLocks.bountyId,
    })
    .from(claimLocks)
    .where(and(eq(claimLocks.status, "active"), lte(claimLocks.expiresAt, now)));

  if (overdue.length === 0) {
    return { expiredLockIds, restoredBountyIds };
  }

  await db.transaction(async (tx) => {
    for (const lock of overdue) {
      const [updated] = await tx
        .update(claimLocks)
        .set({ status: "expired", updatedAt: now })
        .where(and(eq(claimLocks.id, lock.id), eq(claimLocks.status, "active")))
        .returning({ id: claimLocks.id });
      if (!updated) continue;
      expiredLockIds.push(updated.id);

      const [restored] = await tx
        .update(bounties)
        .set({ status: "funded", updatedAt: now })
        .where(and(eq(bounties.id, lock.bountyId), eq(bounties.status, "claim_locked")))
        .returning({ id: bounties.id });
      if (restored) restoredBountyIds.push(restored.id);
    }
  });

  return { expiredLockIds, restoredBountyIds };
}

/** Expire overdue locks for one bounty (acquire/list hot path). */
export async function expireClaimLocksForBounty(
  bountyId: string,
  db: Database,
  now: Date = new Date(),
): Promise<ExpireClaimLocksResult> {
  const [lock] = await db
    .select({
      id: claimLocks.id,
      bountyId: claimLocks.bountyId,
      expiresAt: claimLocks.expiresAt,
      status: claimLocks.status,
    })
    .from(claimLocks)
    .where(and(eq(claimLocks.bountyId, bountyId), eq(claimLocks.status, "active")))
    .limit(1);

  if (!lock || lock.expiresAt.getTime() > now.getTime()) {
    return { expiredLockIds: [], restoredBountyIds: [] };
  }

  return expireClaimLocks(db, now);
}
