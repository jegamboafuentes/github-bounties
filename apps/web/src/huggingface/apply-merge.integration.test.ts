import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, bountySubmissions, claims, hfLinks, repos, users } from "../db/schema";
import type { GitHubHttp } from "../github/api";
import { applyHuggingFaceMerge } from "./apply-merge";
import { handleHuggingFaceWebhook } from "./webhook";

loadDotenvFiles();

const ENABLED = { HF_BOUNTIES_ENABLED: "1", HF_WEBHOOK_SECRET: "hf-secret" };

function discussion(fullName: string, authorId: string, overrides: Record<string, unknown> = {}) {
  return {
    title: "Add the card",
    status: "merged",
    isPullRequest: true,
    createdAt: "2026-10-04T00:00:00.000Z",
    author: { _id: authorId, name: "Ada", isOrgMember: false },
    changes: { base: "refs/heads/main" },
    events: [
      {
        type: "status-change",
        createdAt: "2026-10-04T01:00:00.000Z",
        author: { _id: "hf-owner", name: "maintainer", isOwner: true, isOrgMember: false },
        data: { status: "merged", mergeCommitId: "deadbeef" },
      },
    ],
    repo: { name: fullName, type: "dataset" },
    ...overrides,
  };
}

function httpFor(fullName: string, body: Record<string, unknown>): GitHubHttp {
  return async (url) => {
    if (url.includes("/discussions/")) return { ok: true, status: 200, json: async () => body };
    if (url.endsWith("/refs")) {
      return { ok: true, status: 200, json: async () => ({ branches: [{ name: "main" }] }) };
    }
    if (url.includes("/organizations/")) return { ok: false, status: 404, json: async () => ({}) };
    throw new Error(`unexpected hub url ${url} for ${fullName}`);
  };
}

describe("Hugging Face merge claim", () => {
  it("writes an eligible claim, refuses a self-merge, and flags a weak merger", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const hunterSub = `hf-ada-${suffix}`;
    const posterId = randomUUID();
    const hunterId = randomUUID();
    const fullName = `acme/imdb-${suffix}`;
    const bountyId = randomUUID();
    try {
      await db.insert(users).values([
        { id: posterId, googleSub: `poster-${suffix}`, email: `poster-${suffix}@example.com`, displayName: "Poster" },
        { id: hunterId, googleSub: `hunter-${suffix}`, email: `hunter-${suffix}@example.com`, displayName: "Hunter" },
      ]);
      await db.insert(hfLinks).values([
        { userId: posterId, hfSub: `sub-poster-${suffix}`, hfUsername: "poster" },
        { userId: hunterId, hfSub: hunterSub, hfUsername: "ada" },
      ]);
      const [repo] = await db
        .insert(repos)
        .values({
          fullName,
          connectionKind: "public_reference",
          connectedByUserId: posterId,
          provider: "huggingface",
          providerRepoId: `dataset:${fullName}`,
          hfRepoType: "dataset",
        })
        .returning({ id: repos.id });
      await db.insert(bounties).values({
        id: bountyId,
        repoId: repo!.id,
        provider: "huggingface",
        githubIssueNumber: 9,
        url: `https://huggingface.co/datasets/${fullName}/discussions/9`,
        posterUserId: posterId,
        amountUsdc: "10.000000",
        status: "funded",
        title: "Document the split",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      });
      await db.insert(bountySubmissions).values({
        bountyId,
        userId: hunterId,
        provider: "huggingface",
        prNumber: 12,
        prUrl: `https://huggingface.co/datasets/${fullName}/discussions/12`,
        hfAuthor: "Ada",
        prAuthorProviderId: hunterSub,
        status: "submitted",
      });

      let hits = 0;
      const skipped = await applyHuggingFaceMerge(
        db,
        {
          deliveryId: `off-${suffix}`,
          event: "discussion",
          action: "update:dataset",
          target: { repoType: "dataset", owner: "acme", repo: `imdb-${suffix}`, prNumber: 12 },
        },
        {
          env: {},
          http: async () => {
            hits += 1;
            throw new Error("hub");
          },
        },
      );
      assert.equal(skipped.body.skipped, "hf_disabled");
      assert.equal(hits, 0);

      const eligible = await applyHuggingFaceMerge(
        db,
        {
          deliveryId: `ok-${suffix}`,
          event: "discussion",
          action: "update:dataset",
          target: { repoType: "dataset", owner: "acme", repo: `imdb-${suffix}`, prNumber: 12 },
        },
        { env: ENABLED, http: httpFor(fullName, discussion(fullName, hunterSub)) },
      );
      assert.equal(eligible.eligible, true);
      assert.equal(eligible.claimsWritten, 1);
      const [claim] = await db.select().from(claims).where(eq(claims.bountyId, bountyId));
      assert.equal(claim?.status, "eligible");
      assert.equal(claim?.prAuthorLogin, "Ada");
      assert.equal(claim?.prAuthorProviderId, hunterSub);
      assert.equal(claim?.mergedByLogin, "maintainer");
      assert.equal(claim?.mergeCommitSha, "deadbeef");
      assert.equal(claim?.hunterUserId, hunterId);

      await db
        .update(bountySubmissions)
        .set({ status: "withdrawn" })
        .where(and(eq(bountySubmissions.bountyId, bountyId), eq(bountySubmissions.prNumber, 12)));
      await db.insert(bountySubmissions).values({
        bountyId,
        userId: hunterId,
        provider: "huggingface",
        prNumber: 14,
        prUrl: `https://huggingface.co/datasets/${fullName}/discussions/14`,
        hfAuthor: "Ada",
        status: "submitted",
      });
      const self = await applyHuggingFaceMerge(
        db,
        {
          deliveryId: `self-${suffix}`,
          event: "discussion",
          action: "update:dataset",
          target: { repoType: "dataset", owner: "acme", repo: `imdb-${suffix}`, prNumber: 14 },
        },
        {
          env: ENABLED,
          http: httpFor(fullName, discussion(fullName, hunterSub, { author: { _id: "hf-acme", name: "acme" } })),
        },
      );
      assert.equal(self.eligible, false);
      assert.equal(self.claimsWritten, 0);
      const selfClaims = await db
        .select()
        .from(claims)
        .where(and(eq(claims.bountyId, bountyId), eq(claims.prNumber, 14)));
      assert.equal(selfClaims.length, 0);

      await db
        .update(bountySubmissions)
        .set({ status: "withdrawn" })
        .where(and(eq(bountySubmissions.bountyId, bountyId), eq(bountySubmissions.prNumber, 14)));
      await db.insert(bountySubmissions).values({
        bountyId,
        userId: hunterId,
        provider: "huggingface",
        prNumber: 15,
        prUrl: `https://huggingface.co/datasets/${fullName}/discussions/15`,
        hfAuthor: "Ada",
        status: "submitted",
      });
      const review = await applyHuggingFaceMerge(
        db,
        {
          deliveryId: `review-${suffix}`,
          event: "discussion",
          action: "update:dataset",
          target: { repoType: "dataset", owner: "acme", repo: `imdb-${suffix}`, prNumber: 15 },
        },
        {
          env: ENABLED,
          http: httpFor(
            fullName,
            discussion(fullName, hunterSub, {
              events: [
                {
                  type: "status-change",
                  createdAt: "2026-10-04T01:00:00.000Z",
                  author: { _id: "hf-pat", name: "pat", isOwner: false, isOrgMember: false },
                  data: { status: "merged", mergeCommitId: "cafebabe" },
                },
              ],
            }),
          ),
        },
      );
      assert.equal(review.claimsWritten, 1);
      assert.equal(review.eligible, false);
      const [disputed] = await db
        .select()
        .from(claims)
        .where(and(eq(claims.bountyId, bountyId), eq(claims.prNumber, 15)));
      assert.equal(disputed?.status, "disputed");
      assert.equal(disputed?.rejectionReason, "merger_review_required");

      const webhook = await handleHuggingFaceWebhook(
        {
          headers: new Headers({ "x-webhook-secret": "nope", "webhook-id": `wh-${suffix}` }),
          body: "{}",
        },
        { db, env: ENABLED },
      );
      assert.equal(webhook.status, 401);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
