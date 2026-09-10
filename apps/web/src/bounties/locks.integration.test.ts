import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, claimLocks, githubLinks, repos, users } from "../db/schema";
import { claimedByUntilLabel } from "./display";
import { BountyError } from "./errors";
import { expireClaimLocks } from "./expire";
import { createBountyFromIssueUrl } from "./create";
import { stubFundBounty } from "./fund";
import { getBoardBounty, listBoardBounties } from "./list";
import { acquireClaimLock, releaseClaimLock } from "./locks";

loadDotenvFiles();

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
  await db.insert(githubLinks).values({
    userId: hunterId,
    githubId: BigInt(5_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
    githubLogin: `octo-${suffix}`,
  });
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

describe("V1-4 bounty post + claim-lock", () => {
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
            { db },
          ),
        (err: unknown) => err instanceof BountyError && err.code === "repo_not_connected",
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("enforces one active lock, board caption, early release, and expiry restore", async () => {
    const { db, sql, posterId, hunterId, otherHunterId, fullName } = await fixture();
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
      const lockedAt = new Date("2026-09-09T12:00:00.000Z");
      await stubFundBounty(created.id, posterId, db, lockedAt);

      const first = await acquireClaimLock(created.id, hunterId, {
        db,
        now: lockedAt,
        notify: async () => ({
          attempted: false,
          commentOk: false,
          labelOk: false,
          reason: "test_skip",
        }),
      });
      assert.equal(first.expiresAt.toISOString(), "2026-09-12T12:00:00.000Z");

      const [bountyLocked] = await db
        .select({ status: bounties.status })
        .from(bounties)
        .where(eq(bounties.id, created.id));
      assert.equal(bountyLocked?.status, "claim_locked");

      await assert.rejects(
        () =>
          acquireClaimLock(created.id, otherHunterId, {
            db,
            now: new Date("2026-09-09T13:00:00.000Z"),
            notify: async () => ({
              attempted: false,
              commentOk: false,
              labelOk: false,
            }),
          }),
        (err: unknown) => err instanceof BountyError && err.code === "already_locked",
      );

      const locks = await db.select().from(claimLocks).where(eq(claimLocks.bountyId, created.id));
      assert.equal(locks.filter((row) => row.status === "active").length, 1);

      const board = await getBoardBounty(created.id, db, new Date("2026-09-09T13:00:00.000Z"));
      assert.ok(board?.activeLock);
      assert.equal(
        board.activeLock?.caption,
        claimedByUntilLabel({
          hunterLabel: board.activeLock.hunterLabel,
          expiresAt: first.expiresAt,
        }),
      );
      assert.match(board.activeLock.caption, /^Claimed by octo-/);
      assert.match(board.activeLock.caption, /until 2026-09-12 12:00 UTC$/);

      const listed = await listBoardBounties(
        db,
        { repo: fullName, status: "claim_locked" },
        new Date("2026-09-09T13:00:00.000Z"),
      );
      assert.equal(listed.length, 1);
      assert.ok(listed[0]?.activeLock?.caption.includes("Claimed by"));

      await assert.rejects(
        () => releaseClaimLock(created.id, otherHunterId, db),
        (err: unknown) => err instanceof BountyError && err.code === "not_claimant_or_poster",
      );

      const released = await releaseClaimLock(
        created.id,
        hunterId,
        db,
        new Date("2026-09-09T14:00:00.000Z"),
      );
      assert.equal(released.by, "claimant");
      assert.equal(released.restoredFunded, true);

      const second = await acquireClaimLock(created.id, otherHunterId, {
        db,
        now: new Date("2026-09-09T15:00:00.000Z"),
        notify: async () => ({
          attempted: false,
          commentOk: false,
          labelOk: false,
        }),
      });

      const expired = await expireClaimLocks(db, new Date("2026-09-13T15:00:00.000Z"));
      assert.ok(expired.expiredLockIds.includes(second.lockId));
      assert.ok(expired.restoredBountyIds.includes(created.id));

      const [after] = await db
        .select({ status: bounties.status })
        .from(bounties)
        .where(eq(bounties.id, created.id));
      assert.equal(after?.status, "funded");

      const [lockRow] = await db
        .select({ status: claimLocks.status })
        .from(claimLocks)
        .where(eq(claimLocks.id, second.lockId));
      assert.equal(lockRow?.status, "expired");

      const open = await getBoardBounty(created.id, db, new Date("2026-09-13T15:01:00.000Z"));
      assert.equal(open?.status, "funded");
      assert.equal(open?.activeLock, null);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("lets the poster force-release an active lock", async () => {
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
      await stubFundBounty(created.id, posterId, db);
      await acquireClaimLock(created.id, hunterId, {
        db,
        notify: async () => ({ attempted: false, commentOk: false, labelOk: false }),
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
