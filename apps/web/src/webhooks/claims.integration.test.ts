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
      assert.equal(deliveries[0]?.eligible, true);
      assert.equal(deliveries[0]?.winnerLogin, winnerLogin);
      assert.equal(deliveries[0]?.claimResults?.[0]?.claimId, rows[0]?.id);
      assert.equal(deliveries[0]?.claimResults?.[0]?.status, "eligible");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("records hunter_not_linked on the delivery when the PR author has no github_links row", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const posterId = randomUUID();
    const repoId = randomUUID();
    const bountyId = randomUUID();
    const deliveryId = randomUUID();
    const githubRepoId = BigInt(83_000_000 + Number.parseInt(suffix.slice(0, 6), 16));

    try {
      await db.insert(users).values({
        id: posterId,
        googleSub: `test-poster-unlinked-${suffix}`,
        email: `poster-u-${suffix}@example.com`,
        displayName: "Poster",
      });
      const fullName = `test/unlinked-${suffix}`;
      await db.insert(repos).values({
        id: repoId,
        githubRepoId,
        fullName,
        installationId: BigInt(4245),
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
        title: "locked, hunter not linked",
      });

      const payload = structuredClone(fixture.payload);
      if (payload.repository) payload.repository.full_name = fullName;
      if (payload.pull_request?.base?.repo) payload.pull_request.base.repo.full_name = fullName;
      if (payload.pull_request?.user) payload.pull_request.user.login = "enrique-lb";
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
      assert.deepEqual(result.body.claimSkips, ["hunter_not_linked"]);
      assert.equal((result.body.claims as { skip?: string }[])[0]?.skip, "hunter_not_linked");
      const rows = await db.select().from(claims).where(eq(claims.bountyId, bountyId));
      assert.equal(rows.length, 0);

      const [delivery] = await db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.deliveryId, deliveryId));
      assert.equal(delivery?.eligible, true);
      assert.equal(delivery?.winnerLogin, "enrique-lb");
      assert.equal(delivery?.claimResults?.[0]?.skip, "hunter_not_linked");
      assert.equal(delivery?.claimResults?.[0]?.bountyId, bountyId);
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
      assert.deepEqual(result.body.claimSkips, ["no_funded_bounty"]);
      const rows = await db.select().from(claims).where(eq(claims.bountyId, bountyId));
      assert.equal(rows.length, 0);
      const [delivery] = await db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.deliveryId, deliveryId));
      assert.equal(delivery?.claimResults?.[0]?.skip, "no_funded_bounty");
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

  it("creates the claim on redelivery after the hunter links GitHub", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const posterId = randomUUID();
    const hunterId = randomUUID();
    const repoId = randomUUID();
    const bountyId = randomUUID();
    const deliveryId = randomUUID();
    const githubRepoId = BigInt(84_000_000 + Number.parseInt(suffix.slice(0, 6), 16));

    try {
      await db.insert(users).values([
        {
          id: posterId,
          googleSub: `test-poster-replay-${suffix}`,
          email: `poster-r-${suffix}@example.com`,
          displayName: "Poster",
        },
        {
          id: hunterId,
          googleSub: `test-hunter-replay-${suffix}`,
          email: `hunter-r-${suffix}@example.com`,
          displayName: "Hunter",
        },
      ]);
      const fullName = `test/replay-${suffix}`;
      await db.insert(repos).values({
        id: repoId,
        githubRepoId,
        fullName,
        installationId: BigInt(4246),
        connectedByUserId: posterId,
      });
      await db.insert(bounties).values({
        id: bountyId,
        repoId,
        githubIssueNumber: 42,
        url: `https://github.com/${fullName}/issues/42`,
        posterUserId: posterId,
        amountUsdc: "10.000000",
        status: "funded",
        title: "funded, link later",
      });

      const payload = structuredClone(fixture.payload);
      if (payload.repository) payload.repository.full_name = fullName;
      if (payload.pull_request?.base?.repo) payload.pull_request.base.repo.full_name = fullName;
      if (payload.pull_request?.user) payload.pull_request.user.login = "enrique-lb";
      const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
      const deps = {
        store: postgresDeliveryRecorder(db),
        claims: postgresClaimWriter(db),
        log: () => {},
      };

      const first = await handleGitHubWebhookRequest({
        rawBody,
        signatureHeader: githubSignature256(rawBody, SECRET),
        secret: SECRET,
        deliveryId,
        event: fixture.event,
        deps,
      });
      assert.equal(first.body.eligible, true);
      assert.deepEqual(first.body.claimSkips, ["hunter_not_linked"]);

      await db.insert(githubLinks).values({
        userId: hunterId,
        githubId: BigInt(4_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
        githubLogin: "enrique-lb",
      });

      const second = await handleGitHubWebhookRequest({
        rawBody,
        signatureHeader: githubSignature256(rawBody, SECRET),
        secret: SECRET,
        deliveryId,
        event: fixture.event,
        deps,
      });
      assert.equal(second.body.duplicate, true);
      assert.equal(second.body.replayed, true);
      assert.equal((second.body.claims as { claimId?: string }[])[0]?.claimId != null, true);

      const rows = await db.select().from(claims).where(eq(claims.bountyId, bountyId));
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.status, "eligible");
      assert.equal(rows[0]?.hunterUserId, hunterId);
      assert.equal(rows[0]?.prAuthorLogin, "enrique-lb");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
