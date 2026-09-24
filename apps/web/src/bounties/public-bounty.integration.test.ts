import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, repos, users } from "../db/schema";
import type { GitHubHttp } from "../github/api";
import { upsertInstallationRepos, upsertPublicReferenceRepo } from "../github/persist";
import { createMockRail } from "../escrow/rail";
import { probeCdpEnv } from "../escrow/env";
import { BountyError } from "./errors";
import { fundBounty, topUpBounty } from "./fund";
import { createBountyFromIssueUrl } from "./create";

loadDotenvFiles();

const POSTER_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function scripted(handler: (url: string) => { status?: number; body: unknown }): GitHubHttp {
  return async (url) => {
    const result = handler(url);
    const status = result.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => result.body };
  };
}

function openRepo(id: number, fullName: string) {
  return scripted((url) => {
    if (url.endsWith(`/repos/${fullName}`)) {
      return { body: { id, full_name: fullName, private: false, default_branch: "main" } };
    }
    const issue = url.match(/\/issues\/(\d+)$/);
    return {
      body: {
        title: `Issue ${issue?.[1] ?? "?"}`,
        body: "Public issue body",
        state: "open",
        html_url: `https://github.com/${fullName}/issues/${issue?.[1] ?? "1"}`,
      },
    };
  });
}

async function posterFixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const otherId = randomUUID();
  await db.insert(users).values([
    {
      id: posterId,
      googleSub: `public-poster-${suffix}`,
      email: `public-poster-${suffix}@example.com`,
      displayName: "Public Poster",
      walletAddress: POSTER_ADDRESS,
    },
    {
      id: otherId,
      googleSub: `public-other-${suffix}`,
      email: `public-other-${suffix}@example.com`,
      displayName: "Second Funder",
      walletAddress: OTHER_ADDRESS,
    },
  ]);
  return { db, sql, suffix, posterId, otherId };
}

describe("public issue bounties", () => {
  it("creates a public_reference bounty without an App installation", async () => {
    const { db, sql, suffix, posterId } = await posterFixture();
    const fullName = `android/architecture-samples-${suffix}`;
    const githubRepoId = 70_000_000 + Number.parseInt(suffix.slice(0, 6), 16);
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/1080`,
          amountUsdc: "10",
        },
        { db, env: {}, http: openRepo(githubRepoId, fullName) },
      );
      assert.equal(created.status, "pending_fund");
      assert.equal(created.title, "Issue 1080");
      assert.equal(created.githubIssueNumber, 1080);

      const [repo] = await db.select().from(repos).where(eq(repos.id, created.repoId)).limit(1);
      assert.equal(repo?.connectionKind, "public_reference");
      assert.equal(repo?.installationId, null);
      assert.equal(repo?.connectedByUserId, posterId);
      assert.equal(repo?.githubRepoId, BigInt(githubRepoId));
      assert.equal(repo?.isActive, true);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("blocks closed issues, missing repos, private repos, and pull requests", async () => {
    const { db, sql, suffix, posterId } = await posterFixture();
    const fullName = `octo/public-${suffix}`;
    try {
      await assert.rejects(
        () =>
          createBountyFromIssueUrl(
            {
              posterUserId: posterId,
              issueUrl: `https://github.com/${fullName}/issues/3`,
              amountUsdc: "5",
            },
            {
              db,
              env: {},
              http: scripted((url) => {
                if (url.endsWith(`/repos/${fullName}`)) {
                  return { body: { id: 44, full_name: fullName, private: false, default_branch: "main" } };
                }
                return { body: { title: "Already done", body: "shipped", state: "closed" } };
              }),
            },
          ),
        (err: unknown) => err instanceof BountyError && err.code === "issue_closed",
      );

      await assert.rejects(
        () =>
          createBountyFromIssueUrl(
            {
              posterUserId: posterId,
              issueUrl: `https://github.com/${fullName}/issues/4`,
              amountUsdc: "5",
            },
            {
              db,
              env: {},
              http: scripted(() => ({ status: 404, body: { message: "Not Found" } })),
            },
          ),
        (err: unknown) => err instanceof BountyError && err.code === "issue_not_found",
      );

      await assert.rejects(
        () =>
          createBountyFromIssueUrl(
            {
              posterUserId: posterId,
              issueUrl: `https://github.com/${fullName}/issues/5`,
              amountUsdc: "5",
            },
            {
              db,
              env: {},
              http: scripted(() => ({ status: 403, body: { message: "Resource not accessible by integration" } })),
            },
          ),
        (err: unknown) => err instanceof BountyError && err.code === "issue_inaccessible",
      );

      await assert.rejects(
        () =>
          createBountyFromIssueUrl(
            {
              posterUserId: posterId,
              issueUrl: `https://github.com/${fullName}/issues/6`,
              amountUsdc: "5",
            },
            {
              db,
              env: {},
              http: scripted((url) => {
                if (url.endsWith(`/repos/${fullName}`)) {
                  return { body: { id: 45, full_name: fullName, private: false, default_branch: "main" } };
                }
                return {
                  body: {
                    title: "Not an issue",
                    state: "open",
                    pull_request: { url: "https://api.github.com/pulls/6" },
                  },
                };
              }),
            },
          ),
        (err: unknown) => err instanceof BountyError && err.code === "not_an_issue",
      );

      const rows = await db.select().from(bounties).where(eq(bounties.posterUserId, posterId));
      assert.equal(rows.length, 0);
      const repoRows = await db
        .select()
        .from(repos)
        .where(eq(repos.connectedByUserId, posterId));
      assert.equal(repoRows.length, 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("blocks a closed issue on an App-connected repo", async () => {
    const { db, sql, suffix, posterId } = await posterFixture();
    const fullName = `octo/installed-${suffix}`;
    try {
      await db.insert(repos).values({
        githubRepoId: BigInt(71_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
        fullName,
        installationId: BigInt(9001),
        connectionKind: "app_install",
        connectedByUserId: posterId,
        isActive: true,
      });
      await assert.rejects(
        () =>
          createBountyFromIssueUrl(
            {
              posterUserId: posterId,
              issueUrl: `https://github.com/${fullName}/issues/9`,
              amountUsdc: "5",
            },
            {
              db,
              fetchIssueSnapshot: async () => ({
                title: "Closed on an installed repo",
                body: null,
                htmlUrl: `https://github.com/${fullName}/issues/9`,
                state: "closed",
              }),
            },
          ),
        (err: unknown) =>
          err instanceof BountyError &&
          err.code === "issue_closed" &&
          /already closed/.test(err.message),
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("upgrades a public reference when an App install lands and does not downgrade an active install", async () => {
    const { db, sql, suffix, posterId } = await posterFixture();
    const fullName = `octo/upgrade-${suffix}`;
    const githubRepoId = BigInt(72_000_000 + Number.parseInt(suffix.slice(0, 6), 16));
    try {
      const created = await upsertPublicReferenceRepo({
        userId: posterId,
        githubRepoId,
        fullName,
        db,
      });
      assert.equal(created.connectionKind, "public_reference");
      assert.equal(created.installationId, null);

      const upgraded = await upsertInstallationRepos({
        userId: posterId,
        installationId: BigInt(4242),
        repositories: [{ githubRepoId, fullName }],
        db,
      });
      assert.equal(upgraded[0]?.connectionKind, "app_install");
      assert.equal(upgraded[0]?.installationId, BigInt(4242));
      assert.equal(upgraded[0]?.id, created.id);

      const kept = await upsertPublicReferenceRepo({
        userId: posterId,
        githubRepoId,
        fullName,
        db,
      });
      assert.equal(kept.connectionKind, "app_install");
      assert.equal(kept.installationId, BigInt(4242));
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("still accepts a crowdfund top-up on a funded public_reference bounty", async () => {
    const { db, sql, suffix, posterId, otherId } = await posterFixture();
    const fullName = `octo/topup-${suffix}`;
    const githubRepoId = 73_000_000 + Number.parseInt(suffix.slice(0, 6), 16);
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/8`,
          amountUsdc: "100",
        },
        { db, env: {}, http: openRepo(githubRepoId, fullName) },
      );
      const rail = createMockRail(probeCdpEnv({}));
      await fundBounty(created.id, posterId, db, new Date("2026-09-01T00:00:00.000Z"), { rail });
      const topped = await topUpBounty(
        created.id,
        otherId,
        {
          amountUsdc: "20",
          fundTxHash: `0xtop${suffix}00000000000000000000000000000000000000000000000000`,
          funderAddress: OTHER_ADDRESS,
        },
        db,
        new Date("2026-09-01T00:00:01.000Z"),
        { rail },
      );
      assert.equal(topped.alreadyApplied, false);
      assert.equal(topped.faceUsdc, "120.000000");
      assert.equal(topped.status, "funded");

      const [repo] = await db.select().from(repos).where(eq(repos.id, created.repoId)).limit(1);
      assert.equal(repo?.connectionKind, "public_reference");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
