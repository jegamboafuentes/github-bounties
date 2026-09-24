import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bountyIntelligence, bounties, repos, users } from "../db/schema";
import { listBoardBounties, listBoardBountiesPage } from "./list";

loadDotenvFiles();

describe("board keyset page", () => {
  it("pages by newest and amount without dropping the unpaged board", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const posterId = randomUUID();
    const repoId = randomUUID();
    const fullName = `cursor-page-${suffix}/demo`;
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const times = [
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-02T00:00:00.000Z"),
      new Date("2026-01-03T00:00:00.000Z"),
    ];
    const amounts = ["10.000000", "50.000000", "30.000000"];
    try {
      await db.insert(users).values({
        id: posterId,
        googleSub: `page-poster-${suffix}`,
        email: `page-poster-${suffix}@example.com`,
        displayName: "Page Poster",
      });
      await db.insert(repos).values({
        id: repoId,
        githubRepoId: BigInt(parseInt(suffix, 16) + 80_000_000),
        fullName,
        installationId: null,
        connectionKind: "public_reference",
        connectedByUserId: posterId,
        isActive: true,
      });
      await db.insert(bounties).values(
        ids.map((id, index) => ({
          id,
          repoId,
          githubIssueNumber: index + 1,
          url: `https://github.com/${fullName}/issues/${index + 1}`,
          posterUserId: posterId,
          amountUsdc: amounts[index] ?? "10.000000",
          currency: "USDC",
          chain: "base",
          status: "funded" as const,
          title: `Page ${index + 1}`,
          descriptionSnapshot: `Body ${index + 1}`,
          createdAt: times[index],
          fundedAt: times[index],
        })),
      );
      await db.insert(bountyIntelligence).values({
        bountyId: ids[0],
        status: "ready",
        repoAbout: "Demo",
        languageStack: "TypeScript",
        complexity: "S",
        model: "test",
        sourceFingerprint: "page",
        generatedAt: times[0],
      });

      const all = await listBoardBounties(db, { repo: fullName });
      assert.equal(all.length, 3);

      const newest = await listBoardBountiesPage(db, { repo: fullName }, { limit: 2, sort: "newest" });
      assert.deepEqual(
        newest.bounties.map((row) => row.id),
        [ids[2], ids[1]],
      );
      assert.equal(newest.hasMore, true);
      const newestRest = await listBoardBountiesPage(
        db,
        { repo: fullName },
        {
          limit: 2,
          sort: "newest",
          cursor: { sort: "newest", createdAt: newest.bounties[1]!.createdAt, id: newest.bounties[1]!.id },
        },
      );
      assert.deepEqual(
        newestRest.bounties.map((row) => row.id),
        [ids[0]],
      );
      assert.equal(newestRest.hasMore, false);

      const byAmount = await listBoardBountiesPage(db, { repo: fullName }, { limit: 2, sort: "amount" });
      assert.deepEqual(
        byAmount.bounties.map((row) => row.amountUsdc),
        ["50.000000", "30.000000"],
      );
      const amountRest = await listBoardBountiesPage(
        db,
        { repo: fullName },
        {
          limit: 2,
          sort: "amount",
          cursor: {
            sort: "amount",
            amountUsdc: byAmount.bounties[1]!.amountUsdc,
            id: byAmount.bounties[1]!.id,
          },
        },
      );
      assert.deepEqual(
        amountRest.bounties.map((row) => row.amountUsdc),
        ["10.000000"],
      );

      const small = await listBoardBountiesPage(
        db,
        { repo: fullName, complexity: "S" },
        { limit: 20, sort: "newest" },
      );
      assert.deepEqual(
        small.bounties.map((row) => row.id),
        [ids[0]],
      );
      const withIntel = await listBoardBountiesPage(
        db,
        { repo: fullName },
        { limit: 20, hasIntel: true },
      );
      assert.deepEqual(
        withIntel.bounties.map((row) => row.id),
        [ids[0]],
      );
      const withoutIntel = await listBoardBountiesPage(
        db,
        { repo: fullName },
        { limit: 20, hasIntel: false },
      );
      assert.equal(withoutIntel.bounties.length, 2);
      assert.equal(
        withoutIntel.bounties.some((row) => row.id === ids[0]),
        false,
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
