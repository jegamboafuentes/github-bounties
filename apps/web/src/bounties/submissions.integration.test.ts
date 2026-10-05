import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApiKey, type ApiPrincipal } from "../api/access/handlers";
import { createAccessDeps } from "../api/access/store";
import type { McpAccess } from "../api/access/http";
import { handleV1Action } from "../api/access/http";
import { createBountiesMcpServer } from "../api/public/mcp";
import type { PublicReadApi } from "../api/public/service";
import { createDb, type Database } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, bountySubmissions, hfLinks, repos, users } from "../db/schema";
import type { GitHubHttp } from "../github/api";
import { ProviderNotSupportedError } from "../providers/types";
import { BountyError } from "./errors";
import { listBountySubmissions, submitHuggingFacePr, withdrawBountySubmission } from "./submissions";

loadDotenvFiles();

let currentDb: Database | null = null;
let currentUser: { id: string } | null = null;

mock.module("@/auth/protect", {
  namedExports: {
    getCurrentPublicUser: async () => currentUser,
  },
});

mock.module("@/db/runtime", {
  namedExports: {
    getRuntimeDb: () => {
      if (!currentDb) throw new Error("test db is not set");
      return currentDb;
    },
  },
});

mock.module("next/cache", {
  namedExports: {
    revalidatePath: () => {},
  },
});

mock.module("next/navigation", {
  namedExports: {
    redirect: (url: string) => {
      const err = new Error(`REDIRECT ${url}`);
      (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
      throw err;
    },
  },
});

const ENABLED = { HF_BOUNTIES_ENABLED: "1", API_KEY_HMAC_SECRET: "test-hmac-secret-value" };

function scripted(handler: (url: string) => { status?: number; body: unknown }): GitHubHttp {
  return async (url) => {
    const result = handler(url);
    const status = result.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => result.body };
  };
}

function prBody(
  fullName: string,
  type: "model" | "dataset" | "space",
  overrides: Record<string, unknown> = {},
) {
  return {
    title: "Add the card",
    status: "open",
    isPullRequest: true,
    author: { _id: "hf-ada", name: "Ada" },
    repo: { name: fullName, type },
    ...overrides,
  };
}

async function world() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const hunterId = randomUUID();
  const otherId = randomUUID();
  const unlinkedId = randomUUID();
  const fullName = `stanfordnlp/imdb-${suffix}`;
  const ghName = `octo/hello-${suffix}`;
  await db.insert(users).values([
    { id: posterId, googleSub: `poster-${suffix}`, email: `poster-${suffix}@example.com`, displayName: "Poster" },
    { id: hunterId, googleSub: `hunter-${suffix}`, email: `hunter-${suffix}@example.com`, displayName: "Hunter" },
    { id: otherId, googleSub: `other-${suffix}`, email: `other-${suffix}@example.com`, displayName: "Other" },
    { id: unlinkedId, googleSub: `plain-${suffix}`, email: `plain-${suffix}@example.com`, displayName: "Plain" },
  ]);
  await db.insert(hfLinks).values([
    { userId: hunterId, hfSub: `sub-ada-${suffix}`, hfUsername: "ada" },
    { userId: otherId, hfSub: `sub-bob-${suffix}`, hfUsername: "bob" },
  ]);
  const [hfRepo] = await db
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
  const [ghRepo] = await db
    .insert(repos)
    .values({
      githubRepoId: BigInt(88_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
      fullName: ghName,
      installationId: BigInt(42),
      connectionKind: "app_install",
      connectedByUserId: posterId,
      provider: "github",
    })
    .returning({ id: repos.id });
  const fundedId = randomUUID();
  const pendingId = randomUUID();
  const githubId = randomUUID();
  await db.insert(bounties).values([
    {
      id: fundedId,
      repoId: hfRepo!.id,
      provider: "huggingface",
      githubIssueNumber: 9,
      url: `https://huggingface.co/datasets/${fullName}/discussions/9`,
      posterUserId: posterId,
      amountUsdc: "10.000000",
      status: "funded",
      title: "Document the split",
    },
    {
      id: pendingId,
      repoId: hfRepo!.id,
      provider: "huggingface",
      githubIssueNumber: 10,
      url: `https://huggingface.co/datasets/${fullName}/discussions/10`,
      posterUserId: posterId,
      amountUsdc: "10.000000",
      status: "pending_fund",
      title: "Not funded yet",
    },
    {
      id: githubId,
      repoId: ghRepo!.id,
      provider: "github",
      githubIssueNumber: 4,
      url: `https://github.com/${ghName}/issues/4`,
      posterUserId: posterId,
      amountUsdc: "10.000000",
      status: "funded",
      title: "GitHub issue",
    },
  ]);
  const prUrl = `https://huggingface.co/datasets/${fullName}/discussions/12`;
  const httpFor = (overrides: Record<string, unknown> = {}, status = 200) =>
    scripted(() => ({ status, body: prBody(fullName, "dataset", overrides) }));
  return {
    db,
    sql,
    suffix,
    fullName,
    hunterId,
    otherId,
    unlinkedId,
    fundedId,
    pendingId,
    githubId,
    prUrl,
    httpFor,
  };
}

function expectCode(code: string) {
  return (err: unknown) => {
    assert.ok(err instanceof BountyError || err instanceof ProviderNotSupportedError, String(err));
    assert.equal((err as { code: string }).code, code);
    return true;
  };
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

describe("Hugging Face bounty submissions", () => {
  it("rejects every validation code and stores one submitted row", async () => {
    const fx = await world();
    const call = { db: fx.db, env: ENABLED, http: fx.httpFor() };
    try {
      let hits = 0;
      await assert.rejects(
        () =>
          submitHuggingFacePr(
            { bountyId: fx.fundedId, userId: fx.hunterId, prUrl: fx.prUrl },
            {
              db: fx.db,
              env: {},
              http: async () => {
                hits += 1;
                throw new Error("Hugging Face was called while the flag was off");
              },
            },
          ),
        expectCode("hf_disabled"),
      );
      assert.equal(hits, 0);

      await assert.rejects(
        () =>
          submitHuggingFacePr(
            { bountyId: fx.githubId, userId: fx.hunterId, prUrl: fx.prUrl },
            { db: fx.db, env: ENABLED, http: fx.httpFor() },
          ),
        expectCode("provider_not_supported"),
      );
      await assert.rejects(
        () =>
          submitHuggingFacePr(
            { bountyId: fx.pendingId, userId: fx.hunterId, prUrl: fx.prUrl },
            call,
          ),
        expectCode("bounty_not_open"),
      );
      await assert.rejects(
        () =>
          submitHuggingFacePr(
            { bountyId: fx.fundedId, userId: fx.unlinkedId, prUrl: fx.prUrl },
            call,
          ),
        expectCode("hf_not_linked"),
      );
      await assert.rejects(
        () =>
          submitHuggingFacePr(
            { bountyId: fx.fundedId, userId: fx.hunterId, prUrl: "https://github.com/octo/hello/pull/3" },
            call,
          ),
        expectCode("not_a_pull_request"),
      );
      await assert.rejects(
        () =>
          submitHuggingFacePr(
            { bountyId: fx.fundedId, userId: fx.hunterId, prUrl: fx.prUrl },
            { ...call, http: fx.httpFor({ isPullRequest: false }) },
          ),
        expectCode("not_a_pull_request"),
      );
      await assert.rejects(
        () =>
          submitHuggingFacePr(
            { bountyId: fx.fundedId, userId: fx.hunterId, prUrl: fx.prUrl },
            { ...call, http: fx.httpFor({ repo: { name: "other/repo", type: "dataset" } }) },
          ),
        expectCode("repo_mismatch"),
      );
      await assert.rejects(
        () =>
          submitHuggingFacePr(
            { bountyId: fx.fundedId, userId: fx.hunterId, prUrl: fx.prUrl },
            { ...call, http: fx.httpFor({ author: { _id: "hf-bob", name: "bob" } }) },
          ),
        expectCode("author_mismatch"),
      );
      await assert.rejects(
        () =>
          submitHuggingFacePr(
            { bountyId: fx.fundedId, userId: fx.hunterId, prUrl: fx.prUrl },
            { ...call, http: fx.httpFor({ status: "closed" }) },
          ),
        expectCode("pr_closed"),
      );
      await assert.rejects(
        () =>
          submitHuggingFacePr(
            { bountyId: fx.fundedId, userId: fx.hunterId, prUrl: fx.prUrl },
            { ...call, http: fx.httpFor({ status: "draft" }) },
          ),
        expectCode("pr_closed"),
      );
      await assert.rejects(
        () =>
          submitHuggingFacePr(
            { bountyId: fx.fundedId, userId: fx.hunterId, prUrl: fx.prUrl },
            { ...call, http: scripted(() => ({ status: 404, body: { error: "missing" } })) },
          ),
        expectCode("hf_discussion_not_found"),
      );

      const created = await submitHuggingFacePr(
        { bountyId: fx.fundedId, userId: fx.hunterId, prUrl: fx.prUrl },
        call,
      );
      assert.equal(created.status, "submitted");
      assert.equal(created.provider, "huggingface");
      assert.equal(created.prNum, 12);
      assert.equal(created.hfAuthor, "Ada");
      assert.equal(created.userId, fx.hunterId);
      assert.equal(created.prUrl, fx.prUrl);

      const [row] = await fx.db
        .select()
        .from(bountySubmissions)
        .where(eq(bountySubmissions.id, created.id));
      assert.equal(row?.provider, "huggingface");
      assert.equal(row?.prNumber, 12);
      assert.equal(row?.hfAuthor, "Ada");
      assert.equal(row?.prAuthorProviderId, "hf-ada");
      assert.equal(row?.status, "submitted");

      const listed = await listBountySubmissions(fx.fundedId, { db: fx.db, env: ENABLED });
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.status, "submitted");

      await assert.rejects(
        () =>
          submitHuggingFacePr(
            {
              bountyId: fx.fundedId,
              userId: fx.hunterId,
              prUrl: `https://huggingface.co/datasets/${fx.fullName}/discussions/13`,
            },
            { ...call, http: fx.httpFor() },
          ),
        expectCode("already_submitted"),
      );
      await assert.rejects(
        () =>
          submitHuggingFacePr(
            { bountyId: fx.fundedId, userId: fx.otherId, prUrl: fx.prUrl },
            { ...call, http: fx.httpFor({ author: { _id: "hf-bob", name: "bob" } }) },
          ),
        expectCode("already_submitted"),
      );

      const withdrawn = await withdrawBountySubmission(
        { bountyId: fx.fundedId, userId: fx.hunterId },
        { db: fx.db, env: ENABLED },
      );
      assert.equal(withdrawn.withdrawn, true);
      assert.equal((await listBountySubmissions(fx.fundedId, { db: fx.db, env: ENABLED })).length, 0);
      const [kept] = await fx.db
        .select({ status: bountySubmissions.status })
        .from(bountySubmissions)
        .where(eq(bountySubmissions.id, withdrawn.id));
      assert.equal(kept?.status, "withdrawn");
      await assert.rejects(
        () =>
          withdrawBountySubmission({ bountyId: fx.fundedId, userId: fx.otherId }, { db: fx.db, env: ENABLED }),
        expectCode("submission_not_found"),
      );

      const again = await submitHuggingFacePr(
        { bountyId: fx.fundedId, userId: fx.hunterId, prUrl: fx.prUrl },
        { ...call, http: fx.httpFor({ status: "merged" }) },
      );
      assert.equal(again.status, "submitted");

      await fx.db.update(bounties).set({ status: "settled" }).where(eq(bounties.id, fx.fundedId));
      await assert.rejects(
        () => withdrawBountySubmission({ bountyId: fx.fundedId, userId: fx.hunterId }, { db: fx.db, env: ENABLED }),
        expectCode("bounty_paid"),
      );
    } finally {
      await fx.sql.end({ timeout: 5 });
    }
  });

  it("matches REST and MCP, including the flag and the GitHub regression", async () => {
    const fx = await world();
    const env = ENABLED;
    const deps = { ...createAccessDeps(fx.db, env), hfHttp: fx.httpFor() };
    try {
      const key = await createApiKey({ userId: fx.hunterId, name: "submit", scopes: ["read", "write"] }, deps);
      const readOnly = await createApiKey({ userId: fx.hunterId, name: "read", scopes: ["read"] }, deps);
      const auth = { authorization: `Bearer ${key.token}`, "content-type": "application/json" };

      const denied = await handleV1Action(
        new Request(`https://dev.githubbounties.xyz/api/v1/bounties/${fx.fundedId}/submissions`, {
          method: "POST",
          headers: { authorization: `Bearer ${readOnly.token}`, "content-type": "application/json" },
          body: JSON.stringify({ prUrl: fx.prUrl }),
        }),
        { kind: "submit-pr", bountyId: fx.fundedId },
        deps,
      );
      assert.equal(denied.status, 403);
      assert.equal(await errorCode(denied), "forbidden_scope");

      const off = { ...createAccessDeps(fx.db, { API_KEY_HMAC_SECRET: env.API_KEY_HMAC_SECRET }), hfHttp: fx.httpFor() };
      const disabled = await handleV1Action(
        new Request(`https://dev.githubbounties.xyz/api/v1/bounties/${fx.fundedId}/submissions`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ prUrl: fx.prUrl }),
        }),
        { kind: "submit-pr", bountyId: fx.fundedId },
        off,
      );
      assert.equal(disabled.status, 403);
      assert.equal(await errorCode(disabled), "hf_disabled");

      const github = await handleV1Action(
        new Request(`https://dev.githubbounties.xyz/api/v1/bounties/${fx.githubId}/submissions`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ prUrl: fx.prUrl }),
        }),
        { kind: "submit-pr", bountyId: fx.githubId },
        deps,
      );
      assert.equal(github.status, 501);
      assert.equal(await errorCode(github), "provider_not_supported");

      const posted = await handleV1Action(
        new Request(`https://dev.githubbounties.xyz/api/v1/bounties/${fx.fundedId}/submissions`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ prUrl: fx.prUrl }),
        }),
        { kind: "submit-pr", bountyId: fx.fundedId },
        deps,
      );
      assert.equal(posted.status, 201);
      const created = (await posted.json()) as { status: string; hfAuthor: string; prNum: number };
      assert.equal(created.status, "submitted");
      assert.equal(created.hfAuthor, "Ada");
      assert.equal(created.prNum, 12);

      const listed = await handleV1Action(
        new Request(`https://dev.githubbounties.xyz/api/v1/bounties/${fx.fundedId}/submissions`, {
          headers: { authorization: `Bearer ${key.token}` },
        }),
        { kind: "submissions", bountyId: fx.fundedId },
        deps,
      );
      assert.equal(listed.status, 200);
      const listBody = (await listed.json()) as { submissions: { status: string }[] };
      assert.equal(listBody.submissions.length, 1);
      assert.equal(listBody.submissions[0]?.status, "submitted");

      const principal: ApiPrincipal = {
        keyId: key.key.id,
        userId: fx.hunterId,
        name: key.key.name,
        env: key.key.env,
        prefix: key.key.prefix,
        scopes: new Set(key.key.scopes),
        perTxCapUsdc: key.key.perTxCapUsdc,
        dailyCapUsdc: key.key.dailyCapUsdc,
      };
      const unusedApi: PublicReadApi = {
        async listBounties() {
          throw new Error("unused");
        },
        async getBounty() {
          throw new Error("unused");
        },
        async listFunders() {
          throw new Error("unused");
        },
        async getIntelligence() {
          throw new Error("unused");
        },
        async getStats() {
          throw new Error("unused");
        },
      };
      const access: McpAccess = {
        principal,
        deps,
        ip: "127.0.0.1",
        origin: "https://dev.githubbounties.xyz",
      };
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createBountiesMcpServer(unusedApi, access);
      const client = new Client({ name: "hf-submit", version: "0.0.0" });
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const duplicate = await client.callTool({
        name: "submit_pr",
        arguments: { id: fx.fundedId, prUrl: fx.prUrl },
      });
      assert.equal(duplicate.isError, true);
      const duplicateBody = JSON.parse(textOf(duplicate)) as { error: { code: string } };
      assert.equal(duplicateBody.error.code, "already_submitted");

      const removed = await client.callTool({
        name: "withdraw_submission",
        arguments: { id: fx.fundedId },
      });
      assert.equal(removed.isError, false);
      const removedBody = JSON.parse(textOf(removed)) as { withdrawn: boolean };
      assert.equal(removedBody.withdrawn, true);

      const submitted = await client.callTool({
        name: "submit_pr",
        arguments: { id: fx.fundedId, prUrl: fx.prUrl },
      });
      assert.equal(submitted.isError, false);
      const submittedBody = JSON.parse(textOf(submitted)) as { status: string };
      assert.equal(submittedBody.status, "submitted");

      const mcpList = await client.callTool({
        name: "list_submissions",
        arguments: { id: fx.fundedId },
      });
      const mcpRows = JSON.parse(textOf(mcpList)) as { submissions: { status: string }[] };
      assert.equal(mcpRows.submissions[0]?.status, "submitted");

      const mcpGithub = await client.callTool({
        name: "submit_pr",
        arguments: { id: fx.githubId, prUrl: "https://github.com/octo/hello/pull/4" },
      });
      assert.equal(mcpGithub.isError, true);
      const githubBody = JSON.parse(textOf(mcpGithub)) as { error: { code: string } };
      assert.equal(githubBody.error.code, "provider_not_supported");
      await client.close();
      await server.close();

      const restWithdraw = await handleV1Action(
        new Request(`https://dev.githubbounties.xyz/api/v1/bounties/${fx.fundedId}/submissions`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${key.token}` },
        }),
        { kind: "withdraw-submission", bountyId: fx.fundedId },
        deps,
      );
      assert.equal(restWithdraw.status, 200);
      const restBody = (await restWithdraw.json()) as { withdrawn: boolean };
      assert.equal(restBody.withdrawn, true);
    } finally {
      await fx.sql.end({ timeout: 5 });
    }
  });

  it("submits and withdraws from the website action", async () => {
    const fx = await world();
    currentDb = fx.db;
    currentUser = { id: fx.hunterId };
    const previous = process.env.HF_BOUNTIES_ENABLED;
    process.env.HF_BOUNTIES_ENABLED = "1";
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response(JSON.stringify(prBody(fx.fullName, "dataset")), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const actions = await import("../app/actions/bounties");
      const form = new FormData();
      form.set("bountyId", fx.fundedId);
      form.set("prUrl", fx.prUrl);
      const submitted = await actions.submitHuggingFacePrAction(undefined, form);
      assert.equal(submitted.ok, true);
      assert.equal(fetches > 0, true);
      const rows = await listBountySubmissions(fx.fundedId, { db: fx.db, env: ENABLED });
      assert.equal(rows[0]?.status, "submitted");
      assert.equal(rows[0]?.hfAuthor, "Ada");

      const withdrawn = await actions.withdrawSubmissionAction(undefined, form);
      assert.equal(withdrawn.ok, true);
      assert.equal((await listBountySubmissions(fx.fundedId, { db: fx.db, env: ENABLED })).length, 0);

      process.env.HF_BOUNTIES_ENABLED = "";
      const before = fetches;
      const disabled = await actions.submitHuggingFacePrAction(undefined, form);
      assert.equal(disabled.ok, false);
      assert.equal(disabled.error, "hf_disabled");
      assert.equal(fetches, before);

      const githubForm = new FormData();
      githubForm.set("bountyId", fx.githubId);
      githubForm.set("prUrl", fx.prUrl);
      process.env.HF_BOUNTIES_ENABLED = "1";
      const github = await actions.submitHuggingFacePrAction(undefined, githubForm);
      assert.equal(github.ok, false);
      assert.equal(github.error, "provider_not_supported");
    } finally {
      globalThis.fetch = originalFetch;
      if (previous === undefined) delete process.env.HF_BOUNTIES_ENABLED;
      else process.env.HF_BOUNTIES_ENABLED = previous;
      currentDb = null;
      currentUser = null;
      await fx.sql.end({ timeout: 5 });
    }
  });
});

function textOf(result: { content: unknown }): string {
  const content = result.content;
  assert.ok(Array.isArray(content));
  const first = content[0] as { text?: string };
  return first.text ?? "";
}
