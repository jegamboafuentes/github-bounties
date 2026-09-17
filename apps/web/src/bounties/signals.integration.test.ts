import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { githubLinks, repos, users } from "../db/schema";
import { createBountyFromIssueUrl } from "./create";
import { fundBounty } from "./fund";
import { getBoardBounty } from "./list";
import { clearWorkSignal, signalWorkingOnThis } from "./signals";

loadDotenvFiles();

async function fixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const hunterId = randomUUID();
  const otherHunterId = randomUUID();
  const repoId = randomUUID();
  const fullName = `test/signals-${suffix}`;
  const githubRepoId = BigInt(80_000_000 + Number.parseInt(suffix.slice(0, 6), 16));

  await db.insert(users).values([
    {
      id: posterId,
      googleSub: `poster-sig-${suffix}`,
      email: `poster-sig-${suffix}@example.com`,
      displayName: "Ada Poster",
    },
    {
      id: hunterId,
      googleSub: `hunter-sig-${suffix}`,
      email: `hunter-sig-${suffix}@example.com`,
      displayName: "Hunter One",
    },
    {
      id: otherHunterId,
      googleSub: `hunter2-sig-${suffix}`,
      email: `hunter2-sig-${suffix}@example.com`,
      displayName: "Hunter Two",
    },
  ]);
  await db.insert(githubLinks).values([
    {
      userId: hunterId,
      githubId: BigInt(6_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
      githubLogin: `octo-sig-${suffix}`,
    },
    {
      userId: otherHunterId,
      githubId: BigInt(7_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
      githubLogin: `bob-sig-${suffix}`,
    },
  ]);
  await db.insert(repos).values({
    id: repoId,
    githubRepoId,
    fullName,
    installationId: BigInt(9002),
    connectedByUserId: posterId,
    isActive: true,
  });

  return { db, sql, suffix, posterId, hunterId, otherHunterId, fullName };
}

describe("V2-4 work signals", () => {
  it("lets many hunters signal the same bounty, is not exclusive, and can clear", async () => {
    const { db, sql, posterId, hunterId, otherHunterId, fullName, suffix } = await fixture();
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/21`,
          amountUsdc: "25",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(created.id, posterId, db);

      const first = await signalWorkingOnThis(created.id, hunterId, db);
      assert.equal(first.githubLogin, `octo-sig-${suffix}`);
      const again = await signalWorkingOnThis(created.id, hunterId, db);
      assert.equal(again.id, first.id, "re-signal is a no-op while uncleared");

      const second = await signalWorkingOnThis(created.id, otherHunterId, db);
      assert.notEqual(second.userId, first.userId);

      const board = await getBoardBounty(created.id, db);
      assert.equal(board?.workSignals.length, 2);
      assert.equal(board?.activeLock, null);
      const logins = board?.workSignals.map((row) => row.githubLogin) ?? [];
      assert.ok(logins.includes(`octo-sig-${suffix}`));
      assert.ok(logins.includes(`bob-sig-${suffix}`));
      assert.equal(JSON.stringify(board).includes("Claimed by"), false);

      const cleared = await clearWorkSignal(created.id, hunterId, db);
      assert.equal(cleared.cleared, 1);
      const after = await getBoardBounty(created.id, db);
      assert.equal(after?.workSignals.length, 1);
      assert.equal(after?.workSignals[0]?.userId, otherHunterId);

      const resummon = await signalWorkingOnThis(created.id, hunterId, db);
      assert.notEqual(resummon.id, first.id);
      const both = await getBoardBounty(created.id, db);
      assert.equal(both?.workSignals.length, 2);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
