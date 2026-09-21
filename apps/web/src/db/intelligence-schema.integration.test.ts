import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { loadDotenvFiles } from "./load-dotenv";
import { bountyIntelligence, bounties, repos, users } from "./schema";
import { writeIntelligenceCache, readIntelligenceCache } from "../intelligence/cache";
import { listBoardBounties } from "../bounties/list";

loadDotenvFiles();

describe("bounty_intelligence schema", () => {
  it("upserts one cache row per bounty and rejects invalid complexity", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const userId = randomUUID();
    const repoId = randomUUID();
    const bountyId = randomUUID();

    try {
      await db.insert(users).values({
        id: userId,
        googleSub: `intel-${suffix}`,
        email: `intel-${suffix}@example.com`,
        displayName: "Intel Test",
      });
      await db.insert(repos).values({
        id: repoId,
        githubRepoId: BigInt(70_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
        fullName: `test/intel-${suffix}`,
        installationId: BigInt(11),
        connectedByUserId: userId,
      });
      await db.insert(bounties).values({
        id: bountyId,
        repoId,
        githubIssueNumber: 3,
        url: `https://github.com/test/intel-${suffix}/issues/3`,
        posterUserId: userId,
        amountUsdc: "5.000000",
        status: "funded",
        title: "intel fixture",
        descriptionSnapshot: "Full issue body for hunters.",
        issueBodySyncedAt: new Date(),
      });

      await writeIntelligenceCache(db, {
        bountyId,
        fingerprint: "abc",
        generatedAt: new Date("2026-09-21T00:00:00.000Z"),
        status: "ready",
        output: {
          repoAbout: "A test repo",
          languageStack: "TypeScript",
          complexity: "S",
        },
        model: "gemini-2.5-flash",
      });

      const first = await readIntelligenceCache(bountyId, db);
      assert.equal(first?.complexity, "S");
      assert.equal(first?.status, "ready");

      await writeIntelligenceCache(db, {
        bountyId,
        fingerprint: "def",
        generatedAt: new Date("2026-09-21T01:00:00.000Z"),
        status: "ready",
        output: {
          repoAbout: "Updated about",
          languageStack: "Go",
          complexity: "M",
        },
        model: "gemini-2.5-flash",
      });

      const rows = await db
        .select()
        .from(bountyIntelligence)
        .where(eq(bountyIntelligence.bountyId, bountyId));
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.complexity, "M");
      assert.equal(rows[0]?.languageStack, "Go");
      assert.equal(rows[0]?.sourceFingerprint, "def");

      await assert.rejects(async () => {
        await sql`
          update bounty_intelligence
          set complexity = 'XL'
          where bounty_id = ${bountyId}::uuid
        `;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("board badges hide missing intel and filters exclude unmatched rows", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const userId = randomUUID();
    const repoId = randomUUID();
    const readyId = randomUUID();
    const bareId = randomUUID();
    const fullName = `test/board-intel-${suffix}`;

    try {
      await db.insert(users).values({
        id: userId,
        googleSub: `board-intel-${suffix}`,
        email: `board-intel-${suffix}@example.com`,
        displayName: "Board Intel",
      });
      await db.insert(repos).values({
        id: repoId,
        githubRepoId: BigInt(80_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
        fullName,
        installationId: BigInt(12),
        connectedByUserId: userId,
      });
      await db.insert(bounties).values([
        {
          id: readyId,
          repoId,
          githubIssueNumber: 4,
          url: `https://github.com/${fullName}/issues/4`,
          posterUserId: userId,
          amountUsdc: "5.000000",
          status: "funded",
          title: "ready intel",
        },
        {
          id: bareId,
          repoId,
          githubIssueNumber: 5,
          url: `https://github.com/${fullName}/issues/5`,
          posterUserId: userId,
          amountUsdc: "6.000000",
          status: "funded",
          title: "no intel",
        },
      ]);
      await writeIntelligenceCache(db, {
        bountyId: readyId,
        fingerprint: "board",
        generatedAt: new Date(),
        status: "ready",
        output: {
          repoAbout: "Board repo",
          languageStack: "TypeScript, Next.js",
          complexity: "S",
        },
        model: "gemini-2.5-flash",
      });

      const listed = await listBoardBounties(db, { repo: fullName });
      assert.equal(listed.length, 2);
      const ready = listed.find((row) => row.id === readyId);
      const bare = listed.find((row) => row.id === bareId);
      assert.deepEqual(ready?.intelligence, {
        complexity: "S",
        languageStack: "TypeScript, Next.js",
      });
      assert.equal(bare?.intelligence, null);

      const byComplexity = await listBoardBounties(db, { repo: fullName, complexity: "S" });
      assert.equal(byComplexity.length, 1);
      assert.equal(byComplexity[0]?.id, readyId);

      const byLanguage = await listBoardBounties(db, { repo: fullName, language: "typescript" });
      assert.equal(byLanguage.length, 1);
      assert.equal(byLanguage[0]?.id, readyId);

      const unmatched = await listBoardBounties(db, { repo: fullName, language: "Go" });
      assert.equal(unmatched.length, 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
