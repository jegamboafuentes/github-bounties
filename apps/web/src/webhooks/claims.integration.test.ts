import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, claims, githubLinks, repos, users, webhookDeliveries } from "../db/schema";
import { postgresClaimWriter } from "./claims";
import { postgresDeliveryRecorder } from "./delivery-store";
import { handleGitHubWebhookRequest } from "./http";
import type { GitHubWebhookPayload } from "./types";
import { githubSignature256 } from "./verify-signature";

loadDotenvFiles();

const fixture = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../fixtures/pull-request-merged-fixes.json",
    ),
    "utf8",
  ),
) as {
  deliveryId: string;
  event: string;
  payload: GitHubWebhookPayload;
};

const SECRET = "test-webhook-secret";

describe("eligible Claim from merge+close funded #N", () => {
  it("creates an eligible claim and is idempotent on delivery replay", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const posterId = randomUUID();
    const hunterId = randomUUID();
    const repoId = randomUUID();
    const bountyId = randomUUID();
    const deliveryId = randomUUID();
    const githubRepoId = BigInt(80_000_000 + Number.parseInt(suffix.slice(0, 6), 16));

    try {
      await db.insert(users).values([
        {
          id: posterId,
          googleSub: `test-poster-${suffix}`,
          email: `poster-${suffix}@example.com`,
          displayName: "Poster",
        },
        {
          id: hunterId,
          googleSub: `test-hunter-${suffix}`,
          email: `hunter-${suffix}@example.com`,
          displayName: "Hunter",
        },
      ]);

      const winnerLogin = `winner-${suffix}`;
      await db.insert(githubLinks).values({
        userId: hunterId,
        githubId: BigInt(1_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
        githubLogin: winnerLogin,
      });

      const fullName = `test/hello-${suffix}`;
      await db.insert(repos).values({
        id: repoId,
        githubRepoId,
        fullName,
        installationId: BigInt(4242),
        connectedByUserId: posterId,
        isActive: true,
      });

      await db.insert(bounties).values({
        id: bountyId,
        repoId,
        githubIssueNumber: 42,
        url: `https://github.com/${fullName}/issues/42`,
        posterUserId: posterId,
        amountUsdc: "50.000000",
        status: "funded",
        title: "funded #42",
      });

      const deps = {
        store: postgresDeliveryRecorder(db),
        claims: postgresClaimWriter(db),
        log: () => {},
      };

      const payload = structuredClone(fixture.payload);
      if (payload.repository) payload.repository.full_name = fullName;
      if (payload.pull_request?.base?.repo) payload.pull_request.base.repo.full_name = fullName;
      if (payload.pull_request?.user) payload.pull_request.user.login = winnerLogin;
      const body = Buffer.from(JSON.stringify(payload), "utf8");
      const headers = {
        signature: githubSignature256(body, SECRET),
      };

      const first = await handleGitHubWebhookRequest({
        rawBody: body,
        signatureHeader: headers.signature,
        secret: SECRET,
        deliveryId,
        event: fixture.event,
        deps,
      });
      const second = await handleGitHubWebhookRequest({
        rawBody: body,
        signatureHeader: headers.signature,
        secret: SECRET,
        deliveryId,
        event: fixture.event,
        deps,
      });

      assert.equal(first.status, 200);
      assert.equal(first.body.duplicate, false);
      assert.equal(first.body.eligible, true);
      assert.equal(second.status, 200);
      assert.equal(second.body.duplicate, true);

      const rows = await db.select().from(claims).where(eq(claims.bountyId, bountyId));
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.status, "eligible");
      assert.equal(rows[0]?.hunterUserId, hunterId);
      assert.equal(rows[0]?.prNumber, 15);
      assert.equal(rows[0]?.prAuthorLogin, winnerLogin);
      assert.equal(rows[0]?.closedIssueNumber, 42);

      const deliveries = await db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.deliveryId, deliveryId));
      assert.equal(deliveries.length, 1);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("does not create a claim when the bounty is only pending_fund", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const posterId = randomUUID();
    const hunterId = randomUUID();
    const repoId = randomUUID();
    const bountyId = randomUUID();
    const deliveryId = randomUUID();
    const githubRepoId = BigInt(81_000_000 + Number.parseInt(suffix.slice(0, 6), 16));

    try {
      await db.insert(users).values([
        {
          id: posterId,
          googleSub: `test-poster-pending-${suffix}`,
          email: `poster-p-${suffix}@example.com`,
          displayName: "Poster",
        },
        {
          id: hunterId,
          googleSub: `test-hunter-pending-${suffix}`,
          email: `hunter-p-${suffix}@example.com`,
          displayName: "Hunter",
        },
      ]);
      await db.insert(githubLinks).values({
        userId: hunterId,
        githubId: BigInt(2_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
        githubLogin: "octocat",
      });
      const fullName = `test/pending-${suffix}`;
      await db.insert(repos).values({
        id: repoId,
        githubRepoId,
        fullName,
        installationId: BigInt(4243),
        connectedByUserId: posterId,
      });
      await db.insert(bounties).values({
        id: bountyId,
        repoId,
        githubIssueNumber: 42,
        url: `https://github.com/${fullName}/issues/42`,
        posterUserId: posterId,
        amountUsdc: "10.000000",
        status: "pending_fund",
        title: "not funded",
      });

      const payload = structuredClone(fixture.payload);
      if (payload.repository) payload.repository.full_name = fullName;
      if (payload.pull_request?.base?.repo) payload.pull_request.base.repo.full_name = fullName;
      const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
      const result = await handleGitHubWebhookRequest({
        rawBody,
        signatureHeader: githubSignature256(rawBody, SECRET),
        secret: SECRET,
        deliveryId,
        event: fixture.event,
        deps: {
          store: postgresDeliveryRecorder(db),
          claims: postgresClaimWriter(db),
          log: () => {},
        },
      });

      assert.equal(result.status, 200);
      assert.equal(result.body.eligible, true);
      const rows = await db.select().from(claims).where(eq(claims.bountyId, bountyId));
      assert.equal(rows.length, 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("still writes eligible Claim when the bounty is claim_locked (lock ≠ money)", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const posterId = randomUUID();
    const hunterId = randomUUID();
    const repoId = randomUUID();
    const bountyId = randomUUID();
    const deliveryId = randomUUID();
    const githubRepoId = BigInt(82_000_000 + Number.parseInt(suffix.slice(0, 6), 16));

    try {
      await db.insert(users).values([
        {
          id: posterId,
          googleSub: `test-poster-lock-${suffix}`,
          email: `poster-l-${suffix}@example.com`,
          displayName: "Poster",
        },
        {
          id: hunterId,
          googleSub: `test-hunter-lock-${suffix}`,
          email: `hunter-l-${suffix}@example.com`,
          displayName: "Hunter",
        },
      ]);
      const winnerLogin = `winner-lock-${suffix}`;
      await db.insert(githubLinks).values({
        userId: hunterId,
        githubId: BigInt(3_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
        githubLogin: winnerLogin,
      });
      const fullName = `test/locked-${suffix}`;
      await db.insert(repos).values({
        id: repoId,
        githubRepoId,
        fullName,
        installationId: BigInt(4244),
        connectedByUserId: posterId,
      });
      await db.insert(bounties).values({
        id: bountyId,
        repoId,
        githubIssueNumber: 42,
        url: `https://github.com/${fullName}/issues/42`,
        posterUserId: posterId,
        amountUsdc: "10.000000",
        status: "claim_locked",
        title: "locked but merge is truth",
      });

      const payload = structuredClone(fixture.payload);
      if (payload.repository) payload.repository.full_name = fullName;
      if (payload.pull_request?.base?.repo) payload.pull_request.base.repo.full_name = fullName;
      if (payload.pull_request?.user) payload.pull_request.user.login = winnerLogin;
      const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
      const result = await handleGitHubWebhookRequest({
        rawBody,
        signatureHeader: githubSignature256(rawBody, SECRET),
        secret: SECRET,
        deliveryId,
        event: fixture.event,
        deps: {
          store: postgresDeliveryRecorder(db),
          claims: postgresClaimWriter(db),
          log: () => {},
        },
      });

      assert.equal(result.status, 200);
      assert.equal(result.body.eligible, true);
      const rows = await db.select().from(claims).where(eq(claims.bountyId, bountyId));
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.status, "eligible");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
