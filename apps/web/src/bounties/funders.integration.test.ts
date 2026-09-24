import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bountyContributions, githubLinks, repos, users } from "../db/schema";
import { createBountyFromIssueUrl } from "./create";
import { getBoardBounty, listBoardBounties } from "./list";

loadDotenvFiles();

const base = new Date("2026-09-01T00:00:00.000Z");

function at(seconds: number): Date {
  return new Date(base.getTime() + seconds * 1000);
}

describe("board funder avatar query", () => {
  it("returns the latest distinct funders, capped at 5, with profile pictures", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const posterId = randomUUID();
    const fullName = `test/funders-${suffix}`;
    const githubRepoId = BigInt(83_000_000 + Number.parseInt(suffix.slice(0, 6), 16));
    const funders = [
      {
        id: randomUUID(),
        displayName: "Nina Newest",
        avatarUrl: "https://lh3.googleusercontent.com/a/nina",
        githubLogin: null as string | null,
        githubAvatarUrl: null as string | null,
      },
      {
        id: randomUUID(),
        displayName: "Alice Hidden",
        avatarUrl: "https://lh3.googleusercontent.com/a/alice",
        githubLogin: null,
        githubAvatarUrl: null,
      },
      {
        id: randomUUID(),
        displayName: "Bob",
        avatarUrl: null,
        githubLogin: null,
        githubAvatarUrl: null,
      },
      {
        id: randomUUID(),
        displayName: "Carol",
        avatarUrl: "https://lh3.googleusercontent.com/a/carol",
        githubLogin: null,
        githubAvatarUrl: null,
      },
      {
        id: randomUUID(),
        displayName: "Dave",
        avatarUrl: "http://insecure.example/dave.png",
        githubLogin: `dave-${suffix}`,
        githubAvatarUrl: "https://avatars.githubusercontent.com/u/440?v=4",
      },
      {
        id: randomUUID(),
        displayName: "Eve",
        avatarUrl: null,
        githubLogin: `eve-${suffix}`,
        githubAvatarUrl: null,
      },
    ];

    try {
      await db.insert(users).values([
        {
          id: posterId,
          googleSub: `poster-funders-${suffix}`,
          email: `poster-funders-${suffix}@example.com`,
          displayName: "Ada Poster",
        },
        ...funders.map((funder) => ({
          id: funder.id,
          googleSub: `funder-${funder.id}`,
          email: `${funder.id}@example.com`,
          displayName: funder.displayName,
          avatarUrl: funder.avatarUrl,
        })),
      ]);
      const linked = funders.filter((funder) => funder.githubLogin);
      if (linked.length > 0) {
        await db.insert(githubLinks).values(
          linked.map((funder, index) => ({
            userId: funder.id,
            githubId: BigInt(8_400_000 + index + Number.parseInt(suffix.slice(0, 6), 16)),
            githubLogin: funder.githubLogin!,
            githubAvatarUrl: funder.githubAvatarUrl,
          })),
        );
      }
      await db.insert(repos).values({
        id: randomUUID(),
        githubRepoId,
        fullName,
        installationId: BigInt(9004),
        connectedByUserId: posterId,
        isActive: true,
      });

      const crowded = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/1`,
          amountUsdc: "40",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      const solo = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/2`,
          amountUsdc: "10",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      const empty = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/3`,
          amountUsdc: "5",
        },
        { db, fetchIssueSnapshot: async () => null },
      );

      const [nina, alice, bob, carol, dave, eve] = funders;
      await db.insert(bountyContributions).values([
        contribution(crowded.id, nina!.id, `${suffix}-nina-early`, at(0)),
        contribution(crowded.id, alice!.id, `${suffix}-alice`, at(10)),
        contribution(crowded.id, bob!.id, `${suffix}-bob`, at(20)),
        contribution(crowded.id, carol!.id, `${suffix}-carol`, at(30)),
        contribution(crowded.id, dave!.id, `${suffix}-dave`, at(40)),
        contribution(crowded.id, eve!.id, `${suffix}-eve`, at(50)),
        contribution(crowded.id, nina!.id, `${suffix}-nina-late`, at(100)),
        contribution(solo.id, alice!.id, `${suffix}-solo`, at(5)),
      ]);

      const board = await getBoardBounty(crowded.id, db);
      assert.equal(board?.funderCount, 6);
      assert.deepEqual(
        board?.funders.map((funder) => funder.displayName),
        ["Nina Newest", "Eve", "Dave", "Carol", "Bob"],
      );
      assert.equal(board?.funders[0]?.avatarUrl, "https://lh3.googleusercontent.com/a/nina");
      assert.equal(
        board?.funders[1]?.avatarUrl,
        `https://avatars.githubusercontent.com/eve-${suffix}?s=48`,
      );
      assert.equal(
        board?.funders[2]?.avatarUrl,
        "https://avatars.githubusercontent.com/u/440?v=4",
      );
      assert.equal(board?.funders[3]?.avatarUrl, "https://lh3.googleusercontent.com/a/carol");
      assert.equal(board?.funders[4]?.avatarUrl, null);
      assert.equal(
        board?.funders.some((funder) => funder.displayName === "Alice Hidden"),
        false,
      );

      const listed = await listBoardBounties(db, { repo: fullName });
      const listedCrowded = listed.find((bounty) => bounty.id === crowded.id);
      const listedSolo = listed.find((bounty) => bounty.id === solo.id);
      const listedEmpty = listed.find((bounty) => bounty.id === empty.id);
      assert.equal(listedCrowded?.funderCount, 6);
      assert.equal(listedCrowded?.funders.length, 5);
      assert.equal(listedSolo?.funderCount, 1);
      assert.deepEqual(
        listedSolo?.funders.map((funder) => funder.displayName),
        ["Alice Hidden"],
      );
      assert.equal(listedEmpty?.funderCount, 0);
      assert.deepEqual(listedEmpty?.funders, []);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});

function contribution(bountyId: string, funderUserId: string, fundTxHash: string, createdAt: Date) {
  return {
    bountyId,
    funderUserId,
    amountUsdc: "1.000000",
    fundTxHash,
    createdAt,
    updatedAt: createdAt,
  };
}
