import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, claims, githubLinks, repos, users } from "../db/schema";
import type { PublicClosingPull } from "../github/public-read";
import { pollPublicMerges } from "./public-merge-poller";

loadDotenvFiles();

describe("public merge poller", () => {
  it("writes an eligible claim for a public_reference bounty and ignores a second pass", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const posterId = randomUUID();
    const hunterId = randomUUID();
    const publicRepoId = randomUUID();
    const installedRepoId = randomUUID();
    const publicBountyId = randomUUID();
    const noiseBountyId = randomUUID();
    const installedBountyId = randomUUID();
    const fullName = `android/architecture-samples-${suffix}`;
    const winnerLogin = `winner-${suffix}`;
    const winnerId = 80_000_000 + Number.parseInt(suffix.slice(0, 6), 16);

    try {
      await db.insert(users).values([
        {
          id: posterId,
          googleSub: `poll-poster-${suffix}`,
          email: `poll-poster-${suffix}@example.com`,
          displayName: "Poster",
        },
        {
          id: hunterId,
          googleSub: `poll-hunter-${suffix}`,
          email: `poll-hunter-${suffix}@example.com`,
          displayName: "Hunter",
        },
      ]);
      await db.insert(githubLinks).values({
        userId: hunterId,
        githubId: BigInt(winnerId),
        githubLogin: winnerLogin,
      });
      await db.insert(repos).values([
        {
          id: publicRepoId,
          githubRepoId: BigInt(74_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
          fullName,
          installationId: null,
          connectionKind: "public_reference",
          connectedByUserId: posterId,
          isActive: true,
        },
        {
          id: installedRepoId,
          githubRepoId: BigInt(75_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
          fullName: `octo/installed-${suffix}`,
          installationId: BigInt(55),
          connectionKind: "app_install",
          connectedByUserId: posterId,
          isActive: true,
        },
      ]);
      await db.insert(bounties).values([
        {
          id: publicBountyId,
          repoId: publicRepoId,
          githubIssueNumber: 1080,
          url: `https://github.com/${fullName}/issues/1080`,
          posterUserId: posterId,
          amountUsdc: "25.000000",
          status: "funded",
          title: "public funded",
        },
        {
          id: noiseBountyId,
          repoId: publicRepoId,
          githubIssueNumber: 3,
          url: `https://github.com/${fullName}/issues/3`,
          posterUserId: posterId,
          amountUsdc: "5.000000",
          status: "funded",
          title: "mention only",
        },
        {
          id: installedBountyId,
          repoId: installedRepoId,
          githubIssueNumber: 1080,
          url: `https://github.com/octo/installed-${suffix}/issues/1080`,
          posterUserId: posterId,
          amountUsdc: "5.000000",
          status: "funded",
          title: "installed",
        },
      ]);

      const seen: string[] = [];
      const closing: PublicClosingPull = {
        number: 12,
        title: "Update samples",
        body: "Fixes #1080",
        merged: true,
        authorLogin: winnerLogin,
        authorId: winnerId,
        baseRef: "main",
        defaultBranch: "main",
        mergedAt: "2026-09-24T00:00:00Z",
        mergeCommitSha: "abc",
      };
      const mention: PublicClosingPull = {
        ...closing,
        number: 13,
        title: "Notes",
        body: "Refs #3",
      };

      const listClosingPulls = async (target: { bountyId: string; issueNumber: number; fullName: string }) => {
        seen.push(target.bountyId);
        if (target.fullName !== fullName) return [];
        if (target.issueNumber === 1080) return [closing];
        if (target.issueNumber === 3) return [mention];
        return [];
      };

      const first = await pollPublicMerges(db, {
        listClosingPulls,
        fetchPullRequests: async () => [],
        log: () => {},
      });
      assert.equal(first.errors.length, 0);
      assert.ok(first.eligible >= 1);
      assert.ok(seen.includes(publicBountyId));
      assert.equal(seen.includes(installedBountyId), false);

      const written = await db.select().from(claims).where(eq(claims.bountyId, publicBountyId));
      assert.equal(written.length, 1);
      assert.equal(written[0]?.status, "eligible");
      assert.equal(written[0]?.hunterUserId, hunterId);
      assert.equal(written[0]?.prNumber, 12);
      assert.equal(written[0]?.closedIssueNumber, 1080);

      const noise = await db.select().from(claims).where(eq(claims.bountyId, noiseBountyId));
      assert.equal(noise.length, 0);
      const installed = await db
        .select()
        .from(claims)
        .where(eq(claims.bountyId, installedBountyId));
      assert.equal(installed.length, 0);

      const second = await pollPublicMerges(db, {
        listClosingPulls,
        fetchPullRequests: async () => [],
        log: () => {},
      });
      assert.ok(second.duplicates >= 1);
      const again = await db
        .select()
        .from(claims)
        .where(and(eq(claims.bountyId, publicBountyId), eq(claims.prNumber, 12)));
      assert.equal(again.length, 1);
      assert.equal(again[0]?.id, written[0]?.id);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
