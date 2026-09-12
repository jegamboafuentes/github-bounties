import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, claims, githubLinks, repos, users } from "../db/schema";
import { deleteGithubLinkByUserId, upsertGithubLink } from "./persist";
import { unlinkGithubForUser } from "./unlink";

loadDotenvFiles();

describe("unlink github_links (signed-in user only)", () => {
  it("is 1:1 on user_id and github_id; unlink deletes only that user's link", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const actorId = randomUUID();
    const otherId = randomUUID();
    const repoId = randomUUID();
    const bountyId = randomUUID();
    const claimId = randomUUID();
    const actorGithubId = BigInt(70_000_000 + Number.parseInt(suffix.slice(0, 6), 16));
    const otherGithubId = actorGithubId + BigInt(1);

    try {
      await db.insert(users).values([
        {
          id: actorId,
          googleSub: `test-unlink-actor-${suffix}`,
          email: `actor-${suffix}@example.com`,
          displayName: "Unlink Actor",
        },
        {
          id: otherId,
          googleSub: `test-unlink-other-${suffix}`,
          email: `other-${suffix}@example.com`,
          displayName: "Other User",
        },
      ]);

      await db.insert(githubLinks).values({
        userId: actorId,
        githubId: actorGithubId,
        githubLogin: `jegamboafuentes-${suffix}`,
      });

      await assert.rejects(
        () =>
          db.insert(githubLinks).values({
            userId: actorId,
            githubId: actorGithubId + BigInt(99),
            githubLogin: `second-login-${suffix}`,
          }),
        isUniqueViolation,
      );

      await db.insert(githubLinks).values({
        userId: otherId,
        githubId: otherGithubId,
        githubLogin: `other-login-${suffix}`,
      });

      const thirdId = randomUUID();
      await db.insert(users).values({
        id: thirdId,
        googleSub: `test-unlink-third-${suffix}`,
        email: `third-${suffix}@example.com`,
        displayName: "Third User",
      });
      await assert.rejects(
        () =>
          db.insert(githubLinks).values({
            userId: thirdId,
            githubId: actorGithubId,
            githubLogin: `stolen-${suffix}`,
          }),
        isUniqueViolation,
      );

      await db.insert(repos).values({
        id: repoId,
        githubRepoId: BigInt(60_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
        fullName: `test/unlink-${suffix}`,
        installationId: BigInt(4242),
        connectedByUserId: actorId,
        isActive: true,
      });

      await db.insert(bounties).values({
        id: bountyId,
        repoId,
        githubIssueNumber: 9,
        url: `https://github.com/test/unlink-${suffix}/issues/9`,
        posterUserId: actorId,
        amountUsdc: "10.000000",
        status: "funded",
        title: "unlink cascade guard",
      });

      await db.insert(claims).values({
        id: claimId,
        bountyId,
        hunterUserId: actorId,
        status: "eligible",
        prNumber: 3,
        prAuthorLogin: `jegamboafuentes-${suffix}`,
      });

      const result = await unlinkGithubForUser(actorId, db);
      assert.equal(result.deleted, true);
      assert.equal(result.githubLogin, `jegamboafuentes-${suffix}`);

      const actorLink = await db
        .select()
        .from(githubLinks)
        .where(eq(githubLinks.userId, actorId));
      assert.equal(actorLink.length, 0);

      const [otherLink] = await db
        .select()
        .from(githubLinks)
        .where(eq(githubLinks.userId, otherId));
      assert.equal(otherLink?.githubLogin, `other-login-${suffix}`);

      const [user] = await db.select().from(users).where(eq(users.id, actorId));
      assert.equal(user?.googleSub, `test-unlink-actor-${suffix}`);

      const [bounty] = await db.select().from(bounties).where(eq(bounties.id, bountyId));
      assert.equal(bounty?.title, "unlink cascade guard");

      const [claim] = await db.select().from(claims).where(eq(claims.id, claimId));
      assert.equal(claim?.status, "eligible");
      assert.equal(claim?.hunterUserId, actorId);

      const [repo] = await db.select().from(repos).where(eq(repos.id, repoId));
      assert.equal(repo?.isActive, true);
      assert.equal(repo?.connectedByUserId, actorId);

      const relinked = await upsertGithubLink(
        actorId,
        {
          githubId: actorGithubId + BigInt(50),
          githubLogin: `enrique-lb-${suffix}`,
        },
        db,
      );
      assert.equal(relinked.githubLogin, `enrique-lb-${suffix}`);
      assert.equal(relinked.userId, actorId);

      const noop = await deleteGithubLinkByUserId(randomUUID(), db);
      assert.equal(noop, null);
      const stillLinked = await db
        .select()
        .from(githubLinks)
        .where(eq(githubLinks.userId, actorId));
      assert.equal(stillLinked.length, 1);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
