import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, escrows, repos, users } from "../db/schema";
import type { GitHubHttp } from "../github/api";
import { createMockRail } from "../escrow/rail";
import { probeCdpEnv } from "../escrow/env";
import { claimPayout, claimPoolPayout } from "../claims/payout";
import { ProviderNotSupportedError } from "../providers/types";
import { BountyError } from "./errors";
import { fundBounty } from "./fund";
import { createBountyFromIssueUrl } from "./create";

loadDotenvFiles();

const WALLET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function scripted(handler: (url: string) => { status?: number; body: unknown }): GitHubHttp {
  return async (url) => {
    const result = handler(url);
    const status = result.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => result.body };
  };
}

function hfDiscussion(fullName: string, type: "model" | "dataset" | "space", num: number, overrides: Record<string, unknown> = {}) {
  return {
    title: `Discussion ${num}`,
    status: "open",
    isPullRequest: false,
    author: { _id: "hf-user", name: "ada" },
    events: [{ type: "comment", data: { latest: { raw: "Please document the license." } } }],
    repo: { name: fullName, type },
    ...overrides,
  };
}

function githubIssue(fullName: string, id: number) {
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

async function poster() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  await db.insert(users).values({
    id: posterId,
    googleSub: `hf-poster-${suffix}`,
    email: `hf-poster-${suffix}@example.com`,
    displayName: "HF Poster",
    walletAddress: WALLET,
  });
  return { db, sql, suffix, posterId };
}

describe("Hugging Face bounty create", () => {
  it("creates and funds with the same amount and fees as a GitHub bounty", async () => {
    const { db, sql, suffix, posterId } = await poster();
    const hfName = `stanfordnlp/imdb-${suffix}`;
    const ghName = `octo/hello-${suffix}`;
    const githubRepoId = 76_000_000 + Number.parseInt(suffix.slice(0, 6), 16);
    const env = { HF_BOUNTIES_ENABLED: "1" };
    try {
      const hf = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://huggingface.co/datasets/${hfName}/discussions/9`,
          amountUsdc: "12.5",
        },
        {
          db,
          env,
          http: scripted((url) => {
            assert.match(url, new RegExp(`/api/datasets/${hfName}/discussions/9$`));
            return { body: hfDiscussion(hfName, "dataset", 9) };
          }),
        },
      );
      const gh = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${ghName}/issues/7`,
          amountUsdc: "12.5",
        },
        { db, env, http: githubIssue(ghName, githubRepoId) },
      );

      assert.equal(hf.provider, "huggingface");
      assert.equal(hf.status, "pending_fund");
      assert.equal(hf.githubIssueNumber, 9);
      assert.equal(hf.amountUsdc, gh.amountUsdc);
      assert.equal(hf.amountUsdc, "12.500000");
      assert.equal(hf.url, `https://huggingface.co/datasets/${hfName}/discussions/9`);

      const [hfRow] = await db.select().from(bounties).where(eq(bounties.id, hf.id));
      const [ghRow] = await db.select().from(bounties).where(eq(bounties.id, gh.id));
      assert.equal(hfRow?.provider, "huggingface");
      assert.equal(hfRow?.feeBps, ghRow?.feeBps);
      assert.equal(hfRow?.participationPoolBps, ghRow?.participationPoolBps);
      assert.equal(hfRow?.descriptionSnapshot, "Please document the license.");

      const [repo] = await db.select().from(repos).where(eq(repos.id, hf.repoId));
      assert.equal(repo?.provider, "huggingface");
      assert.equal(repo?.providerRepoId, `dataset:${hfName}`);
      assert.equal(repo?.hfRepoType, "dataset");
      assert.equal(repo?.githubRepoId, null);
      assert.equal(repo?.installationId, null);
      assert.equal(repo?.connectionKind, "public_reference");
      assert.equal(repo?.fullName, hfName);

      const [hfEscrow] = await db.select().from(escrows).where(eq(escrows.bountyId, hf.id));
      const [ghEscrow] = await db.select().from(escrows).where(eq(escrows.bountyId, gh.id));
      assert.equal(hfEscrow?.amountUsdc, ghEscrow?.amountUsdc);
      assert.equal(hfEscrow?.status, "pending");

      const rail = createMockRail(probeCdpEnv({}));
      const funded = await fundBounty(hf.id, posterId, db, new Date("2026-10-03T00:00:00.000Z"), { rail });
      assert.equal(funded.status, "funded");

      await assert.rejects(
        () => claimPayout(hf.id, posterId, { payoutAddress: OTHER }, { db }),
        (err: unknown) =>
          err instanceof ProviderNotSupportedError && err.code === "provider_not_supported",
      );
      await assert.rejects(
        () => claimPoolPayout(hf.id, posterId, { payoutAddress: OTHER }, { db }),
        (err: unknown) =>
          err instanceof ProviderNotSupportedError && err.code === "provider_not_supported",
      );
      const [user] = await db.select().from(users).where(eq(users.id, posterId));
      assert.equal(user?.walletAddress, WALLET);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("refuses a second bounty, pull requests, closed discussions, missing discussions, and a GitHub 404", async () => {
    const { db, sql, suffix, posterId } = await poster();
    const hfName = `owner/repo-${suffix}`;
    const ghName = `octo/missing-${suffix}`;
    const env = { HF_BOUNTIES_ENABLED: "1" };
    const open = scripted(() => ({ body: hfDiscussion(hfName, "model", 4) }));
    try {
      await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://huggingface.co/${hfName}/discussions/4`,
          amountUsdc: "5",
        },
        { db, env, http: open },
      );
      await assert.rejects(
        () =>
          createBountyFromIssueUrl(
            {
              posterUserId: posterId,
              issueUrl: `https://huggingface.co/models/${hfName}/discussions/4`,
              amountUsdc: "5",
            },
            { db, env, http: open },
          ),
        (err: unknown) => err instanceof BountyError && err.code === "bounty_exists",
      );

      await assert.rejects(
        () =>
          createBountyFromIssueUrl(
            {
              posterUserId: posterId,
              issueUrl: `https://huggingface.co/${hfName}/discussions/80`,
              amountUsdc: "5",
            },
            {
              db,
              env,
              http: scripted(() => ({
                body: hfDiscussion(hfName, "model", 80, { status: "merged", isPullRequest: true }),
              })),
            },
          ),
        (err: unknown) => err instanceof BountyError && err.code === "hf_not_a_discussion",
      );

      await assert.rejects(
        () =>
          createBountyFromIssueUrl(
            {
              posterUserId: posterId,
              issueUrl: `https://huggingface.co/spaces/${hfName}/discussions/2`,
              amountUsdc: "5",
            },
            {
              db,
              env,
              http: scripted(() => ({
                body: hfDiscussion(hfName, "space", 2, { status: "closed", isPullRequest: false }),
              })),
            },
          ),
        (err: unknown) => err instanceof BountyError && err.code === "hf_discussion_closed",
      );

      await assert.rejects(
        () =>
          createBountyFromIssueUrl(
            {
              posterUserId: posterId,
              issueUrl: `https://huggingface.co/datasets/${hfName}/discussions/999999`,
              amountUsdc: "5",
            },
            {
              db,
              env,
              http: scripted(() => ({
                status: 404,
                body: { error: "No discussion found matching num #999999" },
              })),
            },
          ),
        (err: unknown) => err instanceof BountyError && err.code === "hf_discussion_not_found",
      );

      await assert.rejects(
        () =>
          createBountyFromIssueUrl(
            {
              posterUserId: posterId,
              issueUrl: `https://github.com/${ghName}/issues/4`,
              amountUsdc: "5",
            },
            {
              db,
              env,
              http: scripted(() => ({ status: 404, body: { message: "Not Found" } })),
            },
          ),
        (err: unknown) => err instanceof BountyError && err.code === "issue_not_found",
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
