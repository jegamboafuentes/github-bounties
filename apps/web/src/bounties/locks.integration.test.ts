import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, claimLocks, githubLinks, repos, users } from "../db/schema";
import { BountyError } from "./errors";
import { expireClaimLocks } from "./expire";
import { createBountyFromIssueUrl } from "./create";
import { fundBounty } from "./fund";
import { getBoardBounty, listBoardBounties } from "./list";
import { acquireClaimLock, releaseClaimLock } from "./locks";
import { claimedByUntilLabel } from "./display";

loadDotenvFiles();

/**
 * Insert the residual lock and `claim_locked` together. Board reads in other
 * test files drain every active lock; a gap between the two writes lets that
 * drain release the lock before the bounty is claim_locked, so the later read
 * leaves status stuck at claim_locked.
 */
async function plantResidualLock(
  db: ReturnType<typeof createDb>["db"],
  lock: {
    id?: string;
    bountyId: string;
    hunterUserId: string;
    lockedAt: Date;
    expiresAt: Date;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(claimLocks).values({ ...lock, status: "active" });
    await tx
      .update(bounties)
      .set({ status: "claim_locked", updatedAt: lock.lockedAt })
      .where(eq(bounties.id, lock.bountyId));
  });
}

async function fixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const hunterId = randomUUID();
  const otherHunterId = randomUUID();
  const repoId = randomUUID();
  const fullName = `test/board-${suffix}`;
  const githubRepoId = BigInt(70_000_000 + Number.parseInt(suffix.slice(0, 6), 16));

  await db.insert(users).values([
    {
      id: posterId,
      googleSub: `poster-${suffix}`,
      email: `poster-${suffix}@example.com`,
      displayName: "Ada Poster",
    },
    {
      id: hunterId,
      googleSub: `hunter-${suffix}`,
      email: `hunter-${suffix}@example.com`,
      displayName: "Hunter One",
    },
    {
      id: otherHunterId,
      googleSub: `hunter2-${suffix}`,
      email: `hunter2-${suffix}@example.com`,
      displayName: "Hunter Two",
    },
  ]);
  await db.insert(githubLinks).values([
    {
      userId: posterId,
      githubId: BigInt(4_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
      githubLogin: `ada-${suffix}`,
    },
    {
      userId: hunterId,
      githubId: BigInt(5_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
      githubLogin: `octo-${suffix}`,
    },
  ]);
  await db.insert(repos).values({
    id: repoId,
    githubRepoId,
    fullName,
    installationId: BigInt(9001),
    connectedByUserId: posterId,
    isActive: true,
  });

  return { db, sql, suffix, posterId, hunterId, otherHunterId, repoId, fullName };
}

function hoursFrom(origin: Date, hours: number): Date {
  return new Date(origin.getTime() + hours * 3600_000);
}

describe("V2-4 bounty post + claim-lock sunset", () => {
  it("creates from a connected issue URL and rejects a second active bounty", async () => {
    const { db, sql, posterId, fullName } = await fixture();
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/9`,
          amountUsdc: "15",
        },
        {
          db,
          fetchIssueSnapshot: async () => ({
            title: "Fix the flaky test",
            body: "Please.",
            htmlUrl: `https://github.com/${fullName}/issues/9`,
            state: "open",
          }),
        },
      );
      assert.equal(created.status, "pending_fund");
      assert.equal(created.title, "Fix the flaky test");
      assert.equal(created.amountUsdc, "15.000000");

      await assert.rejects(
        () =>
          createBountyFromIssueUrl(
            {
              posterUserId: posterId,
              issueUrl: `https://github.com/${fullName}/issues/9`,
              amountUsdc: "20",
            },
            { db, fetchIssueSnapshot: async () => null },
          ),
        (err: unknown) => err instanceof BountyError && err.code === "bounty_exists",
      );

      await assert.rejects(
        () =>
          createBountyFromIssueUrl(
            {
              posterUserId: posterId,
              issueUrl: "https://github.com/not/connected/issues/1",
              amountUsdc: "10",
            },
            {
              db,
              http: async () => ({
                ok: false,
                status: 404,
                json: async () => ({ message: "Not Found" }),
              }),
            },
          ),
        (err: unknown) => err instanceof BountyError && err.code === "issue_not_found",
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("refuses new exclusive locks and drains residual V1 locks on board read", async () => {
    const { db, sql, posterId, hunterId, otherHunterId, fullName, suffix } = await fixture();
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/11`,
          amountUsdc: "50",
        },
        {
          db,
          fetchIssueSnapshot: async () => ({
            title: "Open funded issue",
            body: null,
            htmlUrl: `https://github.com/${fullName}/issues/11`,
            state: "open",
          }),
        },
      );
      const now = new Date();
      const lockedAt = hoursFrom(now, -1);
      const expiresAt = hoursFrom(now, 71);
      const readAt = now;
      await fundBounty(created.id, posterId, db, lockedAt);

      await assert.rejects(
        () =>
          acquireClaimLock(created.id, hunterId, {
            db,
            now: lockedAt,
            notify: async () => ({
              attempted: false,
              commentOk: false,
              labelOk: false,
              reason: "test_skip",
            }),
          }),
        (err: unknown) => err instanceof BountyError && err.code === "lock_sunset",
      );

      const lockId = randomUUID();
      await plantResidualLock(db, {
        id: lockId,
        bountyId: created.id,
        hunterUserId: hunterId,
        lockedAt,
        expiresAt,
      });

      const forbidden = claimedByUntilLabel({
        hunterLabel: `octo-${suffix}`,
        expiresAt,
      });
      assert.match(forbidden, /^Claimed by octo-/);

      const board = await getBoardBounty(created.id, db, readAt);
      assert.equal(board?.activeLock, null);
      assert.equal(board?.status, "funded");
      assert.equal(board?.posterGithubLogin, `ada-${suffix}`);
      assert.equal(JSON.stringify(board).includes("Claimed by"), false);

      const listed = await listBoardBounties(
        db,
        { repo: fullName, status: "funded" },
        readAt,
      );
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.activeLock, null);
      assert.equal(JSON.stringify(listed[0]).includes("Claimed by"), false);

      const [lockRow] = await db
        .select({ status: claimLocks.status })
        .from(claimLocks)
        .where(eq(claimLocks.id, lockId));
      assert.equal(lockRow?.status, "released");

      await assert.rejects(
        () => acquireClaimLock(created.id, otherHunterId, { db }),
        (err: unknown) => err instanceof BountyError && err.code === "lock_sunset",
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("expires overdue residual locks and restores funded without advertising exclusivity", async () => {
    const { db, sql, posterId, hunterId, fullName } = await fixture();
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/12`,
          amountUsdc: "8",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(created.id, posterId, db);
      const lockId = randomUUID();
      const now = new Date();
      const lockedAt = hoursFrom(now, -80);
      const expiresAt = hoursFrom(now, -8);
      await plantResidualLock(db, {
        id: lockId,
        bountyId: created.id,
        hunterUserId: hunterId,
        lockedAt,
        expiresAt,
      });

      const expired = await expireClaimLocks(db, now);
      assert.ok(expired.expiredLockIds.includes(lockId));
      assert.ok(expired.restoredBountyIds.includes(created.id));

      const [after] = await db
        .select({ status: bounties.status })
        .from(bounties)
        .where(eq(bounties.id, created.id));
      assert.equal(after?.status, "funded");

      const open = await getBoardBounty(created.id, db, new Date(now.getTime() + 60_000));
      assert.equal(open?.status, "funded");
      assert.equal(open?.activeLock, null);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("lets the poster force-release a residual lock that has not been drained yet", async () => {
    const { db, sql, posterId, hunterId, fullName } = await fixture();
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/13`,
          amountUsdc: "8",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(created.id, posterId, db);
      const lockedAt = new Date();
      await plantResidualLock(db, {
        bountyId: created.id,
        hunterUserId: hunterId,
        lockedAt,
        expiresAt: new Date(lockedAt.getTime() + 72 * 3600_000),
      });
      const released = await releaseClaimLock(created.id, posterId, db);
      assert.equal(released.by, "poster");
      const [row] = await db
        .select({ status: bounties.status })
        .from(bounties)
        .where(eq(bounties.id, created.id));
      assert.equal(row?.status, "funded");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
