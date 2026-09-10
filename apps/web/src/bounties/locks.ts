import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { bounties, claimLocks, githubLinks, repos, users } from "../db/schema";
import type { GitHubHttp } from "../github/api";
import { CLAIM_LOCK_HOURS } from "../lib/constants";
import { claimLockExpiresAt } from "../lib/money";
import { hunterLabel } from "./display";
import { BountyError } from "./errors";
import { expireClaimLocksForBounty } from "./expire";
import { notifyIssueClaimed, type ClaimNotifyResult } from "./notify";

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
 * Hunter takes the exclusive 72h coordination lock.
 * Schema unique index: one active lock per bounty. Lock ≠ money.
 */
export async function acquireClaimLock(
  bountyId: string,
  hunterUserId: string,
  opts: {
    db: Database;
    now?: Date;
    hours?: number;
    http?: GitHubHttp;
    jwt?: string;
    notify?: typeof notifyIssueClaimed;
  },
): Promise<AcquiredLock> {
  if (!hunterUserId) {
    throw new BountyError("unauthorized", "Sign in with Google to claim a bounty.");
  }

  const now = opts.now ?? new Date();
  const hours = opts.hours ?? CLAIM_LOCK_HOURS;
  await expireClaimLocksForBounty(bountyId, opts.db, now);

  const [bounty] = await opts.db
    .select()
    .from(bounties)
    .where(eq(bounties.id, bountyId))
    .limit(1);
  if (!bounty) {
    throw new BountyError("bounty_not_found", "Bounty not found.");
  }
  if (bounty.status === "claim_locked") {
    throw new BountyError("already_locked", "This bounty already has an active claim-lock.");
  }
  if (bounty.status !== "funded") {
    throw new BountyError(
      "not_claimable",
      `Bounty is ${bounty.status}, not open funded.`,
    );
  }

  const lockedAt = now;
  const expiresAt = claimLockExpiresAt(lockedAt, hours);

  let lockId: string;
  try {
    lockId = await opts.db.transaction(async (tx) => {
      const [lock] = await tx
        .insert(claimLocks)
        .values({
          bountyId,
          hunterUserId,
          lockedAt,
          expiresAt,
          status: "active",
        })
        .returning({ id: claimLocks.id });
      if (!lock) throw new Error("insert claim_lock returned no row");

      const [updated] = await tx
        .update(bounties)
        .set({ status: "claim_locked", updatedAt: now })
        .where(and(eq(bounties.id, bountyId), eq(bounties.status, "funded")))
        .returning({ id: bounties.id });

      if (!updated) {
        throw new BountyError("already_locked", "This bounty already has an active claim-lock.");
      }
      return lock.id;
    });
  } catch (err) {
    if (err instanceof BountyError) throw err;
    if (isUniqueViolation(err)) {
      throw new BountyError("already_locked", "This bounty already has an active claim-lock.");
    }
    throw err;
  }

  const notify = opts.notify ?? notifyIssueClaimed;
  const [repo, hunter, link] = await Promise.all([
    opts.db.select().from(repos).where(eq(repos.id, bounty.repoId)).limit(1).then((rows) => rows[0]),
    opts.db.select().from(users).where(eq(users.id, hunterUserId)).limit(1).then((rows) => rows[0]),
    opts.db
      .select()
      .from(githubLinks)
      .where(eq(githubLinks.userId, hunterUserId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);

  const [owner, name] = (repo?.fullName ?? "/").split("/");
  let notifyResult: ClaimNotifyResult = {
    attempted: false,
    commentOk: false,
    labelOk: false,
    reason: "no_installation",
  };
  try {
    notifyResult = await notify(
      {
        owner: owner ?? "",
        repo: name ?? "",
        issueNumber: bounty.githubIssueNumber,
        installationId: repo?.installationId,
        hunterLabel: hunterLabel({
          githubLogin: link?.githubLogin,
          displayName: hunter?.displayName,
        }),
        expiresAt,
        hours,
      },
      { http: opts.http, jwt: opts.jwt },
    );
  } catch {
    notifyResult = {
      attempted: true,
      commentOk: false,
      labelOk: false,
      reason: "notify_threw",
    };
  }

  return {
    lockId,
    bountyId,
    hunterUserId,
    lockedAt,
    expiresAt,
    notify: notifyResult,
  };
}

/**
 * Claimant early-release or poster force-release.
 * Restores `funded` when the bounty is still `claim_locked`.
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
