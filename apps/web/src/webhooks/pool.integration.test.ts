import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import {
  allocationLedger,
  bounties,
  claimLocks,
  claims,
  githubLinks,
  poolParticipants,
  repos,
  users,
} from "../db/schema";
import { usdcToAtomic } from "../lib/money";
import {
  loadPoolEligibilityFixtures,
  poolEligibilityInputForCase,
} from "../lib/pool-eligibility-fixtures";
import type { PoolPullRequest } from "../lib/pool-eligibility";
import { postgresClaimWriter } from "./claims";
import { postgresDeliveryRecorder } from "./delivery-store";
import { handleGitHubWebhookRequest } from "./http";
import { postgresPoolWriter } from "./pool";
import type { GitHubWebhookPayload } from "./types";
import { githubSignature256 } from "./verify-signature";

loadDotenvFiles();

const SECRET = "test-webhook-secret";
const fixtures = loadPoolEligibilityFixtures();
const FACE = "100.000000";

function payloadFor(args: {
  fullName: string;
  winnerLogin: string;
  winnerId: number;
  mergedAt?: string;
  action?: string;
  merged?: boolean;
  body?: string;
  number?: number;
  createdAt?: string;
  authorType?: string;
}): GitHubWebhookPayload {
  return {
    action: args.action ?? "closed",
    pull_request: {
      number: args.number ?? 100,
      title: "Close funded issue",
      body: args.body ?? "Fixes #42",
      merged: args.merged ?? true,
      merged_at: args.mergedAt ?? fixtures.meta.mergedAt,
      created_at: args.createdAt ?? "2026-09-17T10:00:00.000Z",
      html_url: `https://github.com/${args.fullName}/pull/${args.number ?? 100}`,
      user: {
        login: args.winnerLogin,
        id: args.winnerId,
        type: args.authorType ?? "User",
      },
      base: {
        ref: "main",
        repo: { full_name: args.fullName, default_branch: "main" },
      },
      head: { repo: { full_name: `${args.winnerLogin}/repo` } },
    },
    repository: { full_name: args.fullName, default_branch: "main" },
    installation: { id: 4242 },
  };
}

async function insertFundedWorld(args?: { aliceLinked?: boolean }) {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const winnerId = randomUUID();
  const aliceId = randomUUID();
  const repoId = randomUUID();
  const bountyId = randomUUID();
  const githubRepoId = BigInt(90_000_000 + Number.parseInt(suffix.slice(0, 6), 16));
  const fullName = `test/pool-${suffix}`;
  const winnerLogin = `winner-${suffix}`;
  const aliceLogin = `alice-${suffix}`;
  const posterLogin = `poster-${suffix}`;
  const winnerGithubId = 2_000_000 + Number.parseInt(suffix.slice(0, 6), 16);
  const aliceGithubId = 3_000_000 + Number.parseInt(suffix.slice(0, 6), 16);
  const posterGithubId = 1_000_000 + Number.parseInt(suffix.slice(0, 6), 16);

  await db.insert(users).values([
    {
      id: posterId,
      googleSub: `pool-poster-${suffix}`,
      email: `poster-${suffix}@example.com`,
      displayName: "Poster",
    },
    {
      id: winnerId,
      googleSub: `pool-winner-${suffix}`,
      email: `winner-${suffix}@example.com`,
      displayName: "Winner",
    },
    {
      id: aliceId,
      googleSub: `pool-alice-${suffix}`,
      email: `alice-${suffix}@example.com`,
      displayName: "Alice",
    },
  ]);
  await db.insert(githubLinks).values([
    {
      userId: posterId,
      githubId: BigInt(posterGithubId),
      githubLogin: posterLogin,
    },
    {
      userId: winnerId,
      githubId: BigInt(winnerGithubId),
      githubLogin: winnerLogin,
    },
    ...(args?.aliceLinked === false
      ? []
      : [
          {
            userId: aliceId,
            githubId: BigInt(aliceGithubId),
            githubLogin: aliceLogin,
          },
        ]),
  ]);
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
    amountUsdc: FACE,
    status: "funded",
    title: "funded #42",
  });

  return {
    db,
    sql,
    suffix,
    posterId,
    winnerId,
    aliceId,
    bountyId,
    fullName,
    winnerLogin,
    aliceLogin,
    posterLogin,
    winnerGithubId,
    aliceGithubId,
    posterGithubId,
  };
}

function snapshotFromCase(
  id: string,
  fullName: string,
  actors: {
    winnerLogin: string;
    winnerGithubId: number;
    aliceLogin?: string;
    aliceGithubId?: number;
    posterLogin?: string;
    posterGithubId?: number;
  },
): PoolPullRequest[] {
  const row = fixtures.cases.find((c) => c.id === id);
  if (!row) throw new Error(`missing fixture ${id}`);
  const input = poolEligibilityInputForCase(row);
  return input.pullRequests.map((pr) => {
    const mapped = { ...pr, baseRepositoryFullName: fullName };
    if (pr.authorLogin === "winner") {
      mapped.authorLogin = actors.winnerLogin;
      mapped.authorId = actors.winnerGithubId;
      mapped.commitAuthorsAtFreeze = [
        { login: actors.winnerLogin, githubId: actors.winnerGithubId },
      ];
    }
    if (pr.authorLogin === "alice" && actors.aliceLogin && actors.aliceGithubId) {
      mapped.authorLogin = actors.aliceLogin;
      mapped.authorId = actors.aliceGithubId;
      mapped.commitAuthorsAtFreeze = [
        { login: actors.aliceLogin, githubId: actors.aliceGithubId },
      ];
    }
    if (pr.authorLogin === "poster" && actors.posterLogin && actors.posterGithubId) {
      mapped.authorLogin = actors.posterLogin;
      mapped.authorId = actors.posterGithubId;
      mapped.commitAuthorsAtFreeze = [
        { login: actors.posterLogin, githubId: actors.posterGithubId },
      ];
    }
    return mapped;
  });
}

describe("V2-2 pool freeze from winning merge", () => {
  it("writes winner + pool rows, keeps V1 claim, moves no USDC, and is idempotent", async () => {
    const world = await insertFundedWorld();
    const { db, sql, bountyId, fullName, winnerLogin, aliceLogin } = world;
    try {
      const snapshot = snapshotFromCase("qualifying-basic", fullName, world);
      const payload = payloadFor({
        fullName,
        winnerLogin,
        winnerId: world.winnerGithubId,
      });
      const deps = {
        store: postgresDeliveryRecorder(db),
        claims: postgresClaimWriter(db),
        pool: postgresPoolWriter(db, {
          fetchPullRequests: async () => snapshot,
        }),
        log: () => {},
      };
      const body = Buffer.from(JSON.stringify(payload), "utf8");
      const deliveryId = randomUUID();

      const first = await handleGitHubWebhookRequest({
        rawBody: body,
        signatureHeader: githubSignature256(body, SECRET),
        secret: SECRET,
        deliveryId,
        event: "pull_request",
        deps,
      });
      const second = await handleGitHubWebhookRequest({
        rawBody: body,
        signatureHeader: githubSignature256(body, SECRET),
        secret: SECRET,
        deliveryId,
        event: "pull_request",
        deps,
      });

      assert.equal(first.status, 200);
      assert.equal(first.body.eligible, true);
      assert.equal(first.body.poolFrozen, true);
      assert.equal(second.body.duplicate, true);

      const claimRows = await db.select().from(claims).where(eq(claims.bountyId, bountyId));
      assert.equal(claimRows.length, 1);
      assert.equal(claimRows[0]?.status, "eligible");
      assert.equal(claimRows[0]?.prAuthorLogin, winnerLogin);

      const participants = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, bountyId));
      const winner = participants.find((row) => row.role === "winner");
      const alice = participants.find((row) => row.role === "pool");
      assert.equal(winner?.githubLogin, winnerLogin);
      assert.equal(alice?.githubLogin, aliceLogin);
      assert.equal(usdcToAtomic(alice?.shareUsdc ?? "0"), usdcToAtomic("14.700000"));
      assert.equal(usdcToAtomic(winner?.shareUsdc ?? "0"), usdcToAtomic("83.300000"));
      assert.ok(winner?.frozenAt);
      const frozenAt = winner?.frozenAt?.toISOString();

      const secondParticipants = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, bountyId));
      assert.equal(secondParticipants.length, participants.length);
      assert.equal(secondParticipants.find((row) => row.role === "winner")?.frozenAt?.toISOString(), frozenAt);

      const legs = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, bountyId));
      assert.equal(legs.length, 0);
      const locks = await db.select().from(claimLocks).where(eq(claimLocks.bountyId, bountyId));
      assert.equal(locks.length, 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("writes late PRs as skipped, not pool, and does not acquire a lock", async () => {
    const world = await insertFundedWorld();
    const { db, sql, bountyId, fullName, winnerLogin } = world;
    try {
      const snapshot = snapshotFromCase("late-pr", fullName, world);
      const payload = payloadFor({
        fullName,
        winnerLogin,
        winnerId: world.winnerGithubId,
      });
      const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
      const result = await handleGitHubWebhookRequest({
        rawBody,
        signatureHeader: githubSignature256(rawBody, SECRET),
        secret: SECRET,
        deliveryId: randomUUID(),
        event: "pull_request",
        deps: {
          store: postgresDeliveryRecorder(db),
          claims: postgresClaimWriter(db),
          pool: postgresPoolWriter(db, { fetchPullRequests: async () => snapshot }),
          log: () => {},
        },
      });
      assert.equal(result.status, 200);
      const participants = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, bountyId));
      assert.equal(participants.filter((row) => row.role === "pool").length, 0);
      assert.equal(participants.find((row) => row.role === "winner")?.githubLogin, winnerLogin);
      const skips = result.body.poolSkips as string[];
      assert.ok(skips.includes("late_pr"));
      const locks = await db.select().from(claimLocks).where(eq(claimLocks.bountyId, bountyId));
      assert.equal(locks.length, 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("persists unlinked hunters with null user_id and hunter_not_linked", async () => {
    const world = await insertFundedWorld({ aliceLinked: false });
    const { db, sql, bountyId, fullName, winnerLogin, aliceLogin, aliceId } = world;
    try {
      const snapshot = snapshotFromCase("qualifying-basic", fullName, world);
      const payload = payloadFor({
        fullName,
        winnerLogin,
        winnerId: world.winnerGithubId,
      });
      const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
      await handleGitHubWebhookRequest({
        rawBody,
        signatureHeader: githubSignature256(rawBody, SECRET),
        secret: SECRET,
        deliveryId: randomUUID(),
        event: "pull_request",
        deps: {
          store: postgresDeliveryRecorder(db),
          claims: postgresClaimWriter(db),
          pool: postgresPoolWriter(db, { fetchPullRequests: async () => snapshot }),
          log: () => {},
        },
      });
      const poolRow = (await db.select().from(poolParticipants).where(eq(poolParticipants.bountyId, bountyId)))
        .find((row) => row.role === "pool");
      assert.equal(poolRow?.githubLogin, aliceLogin);
      assert.equal(poolRow?.userId, null);
      assert.equal(poolRow?.skipReason, "hunter_not_linked");

      await db.insert(githubLinks).values({
        userId: aliceId,
        githubId: BigInt(world.aliceGithubId),
        githubLogin: aliceLogin,
      });
      const { backfillUnlinkedPoolParticipants } = await import("./pool");
      await backfillUnlinkedPoolParticipants(
        {
          userId: aliceId,
          githubLogin: aliceLogin,
          githubId: BigInt(world.aliceGithubId),
        },
        db,
      );
      const linked = (await db.select().from(poolParticipants).where(eq(poolParticipants.bountyId, bountyId)))
        .find((row) => row.role === "pool");
      assert.equal(linked?.userId, aliceId);
      assert.equal(linked?.skipReason, null);
      assert.ok(linked?.frozenAt);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("empty-pool freeze: only winner, 100% of post-fee share, no pool members", async () => {
    const world = await insertFundedWorld();
    const { db, sql, bountyId, fullName, winnerLogin } = world;
    try {
      const snapshot = snapshotFromCase("empty-pool", fullName, world);
      const payload = payloadFor({
        fullName,
        winnerLogin,
        winnerId: world.winnerGithubId,
      });
      const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
      await handleGitHubWebhookRequest({
        rawBody,
        signatureHeader: githubSignature256(rawBody, SECRET),
        secret: SECRET,
        deliveryId: randomUUID(),
        event: "pull_request",
        deps: {
          store: postgresDeliveryRecorder(db),
          claims: postgresClaimWriter(db),
          pool: postgresPoolWriter(db, { fetchPullRequests: async () => snapshot }),
          log: () => {},
        },
      });
      const participants = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, bountyId));
      assert.equal(participants.length, 1);
      assert.equal(participants[0]?.role, "winner");
      assert.equal(usdcToAtomic(participants[0]?.shareUsdc ?? "0"), usdcToAtomic("98.000000"));
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("|E|=11: first 10 pool, 11th overflow share 0", async () => {
    const world = await insertFundedWorld();
    const { db, sql, bountyId, fullName, winnerLogin } = world;
    try {
      const snapshot = snapshotFromCase("cap-11th", fullName, world);
      const payload = payloadFor({
        fullName,
        winnerLogin,
        winnerId: world.winnerGithubId,
      });
      const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
      await handleGitHubWebhookRequest({
        rawBody,
        signatureHeader: githubSignature256(rawBody, SECRET),
        secret: SECRET,
        deliveryId: randomUUID(),
        event: "pull_request",
        deps: {
          store: postgresDeliveryRecorder(db),
          claims: postgresClaimWriter(db),
          pool: postgresPoolWriter(db, { fetchPullRequests: async () => snapshot }),
          log: () => {},
        },
      });
      const participants = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, bountyId));
      assert.equal(participants.filter((row) => row.role === "pool").length, 10);
      const overflow = participants.filter((row) => row.role === "overflow");
      assert.equal(overflow.length, 1);
      assert.equal(usdcToAtomic(overflow[0]?.shareUsdc ?? "1"), 0n);
      assert.equal(overflow[0]?.skipReason, "overflow");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("opened referencing PR upserts an unfrozen candidate; freeze overwrites it", async () => {
    const world = await insertFundedWorld();
    const { db, sql, bountyId, fullName, winnerLogin, aliceLogin } = world;
    try {
      const opened: GitHubWebhookPayload = payloadFor({
        fullName,
        winnerLogin: aliceLogin,
        winnerId: world.aliceGithubId,
        action: "opened",
        merged: false,
        body: "Refs #42",
        number: 10,
        createdAt: "2026-09-17T11:00:00.000Z",
      });
      const deps = {
        store: postgresDeliveryRecorder(db),
        claims: postgresClaimWriter(db),
        pool: postgresPoolWriter(db, {
          fetchPullRequests: async () => snapshotFromCase("qualifying-basic", fullName, world),
        }),
        log: () => {},
      };
      const openedBody = Buffer.from(JSON.stringify(opened), "utf8");
      const openedResult = await handleGitHubWebhookRequest({
        rawBody: openedBody,
        signatureHeader: githubSignature256(openedBody, SECRET),
        secret: SECRET,
        deliveryId: randomUUID(),
        event: "pull_request",
        deps,
      });
      assert.equal(openedResult.body.eligible, false);
      const before = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, bountyId));
      assert.equal(before.length, 1);
      assert.equal(before[0]?.frozenAt, null);
      assert.equal(before[0]?.githubLogin, aliceLogin);

      const merge = payloadFor({
        fullName,
        winnerLogin,
        winnerId: world.winnerGithubId,
      });
      const mergeBody = Buffer.from(JSON.stringify(merge), "utf8");
      await handleGitHubWebhookRequest({
        rawBody: mergeBody,
        signatureHeader: githubSignature256(mergeBody, SECRET),
        secret: SECRET,
        deliveryId: randomUUID(),
        event: "pull_request",
        deps,
      });
      const after = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, bountyId));
      assert.ok(after.find((row) => row.role === "winner")?.frozenAt);
      assert.ok(after.find((row) => row.githubLogin === aliceLogin)?.frozenAt);
      assert.equal(usdcToAtomic(after.find((row) => row.githubLogin === aliceLogin)?.shareUsdc ?? "0"), usdcToAtomic("14.700000"));
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
