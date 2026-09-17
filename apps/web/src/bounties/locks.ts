import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, claimLocks } from "../db/schema";
import type { GitHubHttp } from "../github/api";
import { BountyError } from "./errors";
import type { notifyIssueClaimed, ClaimNotifyResult } from "./notify";

export type AcquiredLock = {
  lockId: string;
  bountyId: string;
  hunterUserId: string;
  lockedAt: Date;
  expiresAt: Date;
  notify: ClaimNotifyResult;
};

export type ReleasedLock = {
  lockId: string;
  bountyId: string;
  status: "released";
  restoredFunded: boolean;
  by: "claimant" | "poster";
};

/**
 * Exclusive 72h claim-lock is retired (V2-4 / ADR 0003).
 * `/board` and `/bounties/[id]` must not start a lock. Residual V1 rows
 * drain on read via `expireClaimLocks`. Use non-exclusive `work_signals`.
 */
export async function acquireClaimLock(
  bountyId: string,
  hunterUserId: string,
  _opts: {
    db: Database;
    now?: Date;
    hours?: number;
    http?: GitHubHttp;
    jwt?: string;
    notify?: typeof notifyIssueClaimed;
  },
): Promise<AcquiredLock> {
  void bountyId;
  void hunterUserId;
  throw new BountyError(
    "lock_sunset",
    "Exclusive 72h claim-lock is retired. Use Working on this — it is not exclusive and does not move money.",
  );
}

/**
 * Residual V1 lock: claimant early-release or poster force-release.
 * Restores `funded` when the bounty is still `claim_locked`. Board/detail
 * also drain active locks on read, so this is a fallback.
 */
export async function releaseClaimLock(
  bountyId: string,
  actorUserId: string,
  db: Database,
  now: Date = new Date(),
): Promise<ReleasedLock> {
  if (!actorUserId) {
    throw new BountyError("unauthorized", "Sign in with Google to release a claim-lock.");
  }

  const [bounty] = await db.select().from(bounties).where(eq(bounties.id, bountyId)).limit(1);
  if (!bounty) {
    throw new BountyError("bounty_not_found", "Bounty not found.");
  }

  const [lock] = await db
    .select()
    .from(claimLocks)
    .where(and(eq(claimLocks.bountyId, bountyId), eq(claimLocks.status, "active")))
    .limit(1);

  if (!lock) {
    throw new BountyError("lock_not_active", "There is no active claim-lock on this bounty.");
  }

  const isClaimant = lock.hunterUserId === actorUserId;
  const isPoster = bounty.posterUserId === actorUserId;
  if (!isClaimant && !isPoster) {
    throw new BountyError(
      "not_claimant_or_poster",
      "Only the lock holder or the poster can release this claim-lock.",
    );
  }

  let restoredFunded = false;
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(claimLocks)
      .set({ status: "released", updatedAt: now })
      .where(and(eq(claimLocks.id, lock.id), eq(claimLocks.status, "active")))
      .returning({ id: claimLocks.id });
    if (!updated) {
      throw new BountyError("lock_not_active", "There is no active claim-lock on this bounty.");
    }

    const [restored] = await tx
      .update(bounties)
      .set({ status: "funded", updatedAt: now })
      .where(and(eq(bounties.id, bountyId), eq(bounties.status, "claim_locked")))
      .returning({ id: bounties.id });
    restoredFunded = Boolean(restored);
  });

  return {
    lockId: lock.id,
    bountyId,
    status: "released",
    restoredFunded,
    by: isClaimant ? "claimant" : "poster",
  };
}
