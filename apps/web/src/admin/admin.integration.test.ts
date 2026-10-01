import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createBountyFromIssueUrl } from "../bounties/create";
import { fundBounty } from "../bounties/fund";
import { getBoardBounty, listBoardBounties } from "../bounties/list";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, claims, feeLedger, platformSettings, users, repos } from "../db/schema";
import { createMockRail } from "../escrow/rail";
import { probeCdpEnv } from "../escrow/env";
import { settleEscrow } from "../escrow/service";
import { getPlatformStats } from "../stats/get-platform-stats";
import { softDeleteBounty } from "./delete";
import { AdminError } from "./errors";
import { setPlatformFeeBps, readPlatformSettings } from "./settings";

loadDotenvFiles();

const HUNTER = "0x1111111111111111111111111111111111111111";

async function fixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const hunterId = randomUUID();
  const fullName = `test/admin-${suffix}`;
  await db.insert(users).values([
    {
      id: posterId,
      googleSub: `poster-admin-${suffix}`,
      email: `poster-admin-${suffix}@example.com`,
      displayName: "Ada",
      walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    {
      id: hunterId,
      googleSub: `hunter-admin-${suffix}`,
      email: `hunter-admin-${suffix}@example.com`,
      displayName: "Hunter",
      walletAddress: HUNTER,
    },
  ]);
  await db.insert(repos).values({
    id: randomUUID(),
    githubRepoId: BigInt(90_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
    fullName,
    installationId: BigInt(9014),
    connectedByUserId: posterId,
    isActive: true,
  });
  return { db, sql, posterId, hunterId, fullName };
}

async function post(
  db: Awaited<ReturnType<typeof fixture>>["db"],
  posterId: string,
  fullName: string,
  n: number,
) {
  return createBountyFromIssueUrl(
    {
      posterUserId: posterId,
      issueUrl: `https://github.com/${fullName}/issues/${n}`,
      amountUsdc: "100",
    },
    { db, fetchIssueSnapshot: async () => null },
  );
}

describe("admin settings, stamping, and soft delete", () => {
  it("stamps new bounties from settings and settles the old bounty at 200 after the fee moves to 500", async () => {
    const { db, sql, posterId, hunterId, fullName } = await fixture();
    const rail = createMockRail(probeCdpEnv({}));
    try {
      await setPlatformFeeBps(db, "admin@example.com", 200);
      const first = await post(db, posterId, fullName, 1);
      const [stamped] = await db.select().from(bounties).where(eq(bounties.id, first.id));
      assert.equal(stamped?.feeBps, 200);
      assert.equal(stamped?.participationPoolBps, 1500);

      await setPlatformFeeBps(db, "admin@example.com", 500);
      const second = await post(db, posterId, fullName, 2);
      const [later] = await db.select().from(bounties).where(eq(bounties.id, second.id));
      assert.equal(later?.feeBps, 500);
      const [still] = await db.select().from(bounties).where(eq(bounties.id, first.id));
      assert.equal(still?.feeBps, 200);

      await fundBounty(first.id, posterId, db, new Date(), { rail });
      await db.insert(claims).values({
        bountyId: first.id,
        hunterUserId: hunterId,
        status: "eligible",
        prNumber: 1,
        payoutAddress: HUNTER,
      });
      const settled = await settleEscrow(first.id, { actorUserId: posterId, scope: "winner_and_fee" }, { db, rail });
      assert.equal(settled.feeBps, 200);
      const [fee] = await db.select().from(feeLedger).where(eq(feeLedger.bountyId, first.id));
      assert.equal(fee?.feeBps, 200);
      assert.equal(fee?.feeUsdc, "2.000000");
    } finally {
      await setPlatformFeeBps(db, "admin@example.com", 200).catch(() => undefined);
      await sql.end({ timeout: 5 });
    }
  });

  it("refuses a funded delete and hides an unfunded delete from the board and stats", async () => {
    const { db, sql, posterId, fullName } = await fixture();
    const rail = createMockRail(probeCdpEnv({}));
    try {
      const open = await post(db, posterId, fullName, 3);
      const before = await getPlatformStats(db);
      await softDeleteBounty({ bountyId: open.id, actorEmail: "Admin@Example.com", db });
      assert.equal(await getBoardBounty(open.id, db), null);
      const listed = await listBoardBounties(db, { repo: fullName });
      assert.equal(listed.some((row) => row.id === open.id), false);
      const after = await getPlatformStats(db);
      assert.ok(after.bounties.total <= before.bounties.total);

      const funded = await post(db, posterId, fullName, 4);
      await fundBounty(funded.id, posterId, db, new Date(), { rail });
      await assert.rejects(
        () => softDeleteBounty({ bountyId: funded.id, actorEmail: "admin@example.com", db }),
        (err: unknown) => err instanceof AdminError && err.code === "bounty_has_funds_refund_first",
      );
      const settings = await readPlatformSettings(db);
      assert.equal(settings.feeBps >= 0, true);
      const [row] = await db.select().from(platformSettings).limit(1);
      assert.ok(row);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
