import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAuthedMcpTools } from "../api/access/mcp-tools";
import type { AccessDeps } from "../api/access/deps";
import { handleCreateBounty, resultFromError, type ApiPrincipal } from "../api/access/handlers";
import type { McpAccess } from "../api/access/http";
import { PUBLIC_API_VERSION } from "../api/public/version";
import { apiResultResponse } from "../api/access/http";
import { HuggingFaceReadError } from "../providers/huggingface";
import { bountyErrorForHuggingFace } from "./hf-create";
import { BountyError } from "./errors";
import { createBountyFromIssueUrl } from "./create";

const HF_URL = "https://huggingface.co/datasets/stanfordnlp/imdb/discussions/9";

function principal(): ApiPrincipal {
  return {
    keyId: "key-1",
    userId: "user-1",
    name: "qa",
    env: "test",
    prefix: "gb_test_",
    scopes: new Set(["read", "write"]),
    perTxCapUsdc: "50.000000",
    dailyCapUsdc: "200.000000",
  };
}

function textOf(result: { content: unknown }): string {
  const content = result.content;
  assert.ok(Array.isArray(content));
  const first = content[0] as { text?: string };
  return first.text ?? "";
}

describe("Hugging Face rate limit errors", () => {
  it("includes Retry-After on the API error when Hugging Face sent it", async () => {
    const err = bountyErrorForHuggingFace(
      new HuggingFaceReadError("hf_rate_limited", 429, "slow", "30"),
      "stanfordnlp/imdb#9",
    );
    assert.equal(err.code, "hf_rate_limited");
    assert.equal(err.details?.retryAfter, "30");
    assert.equal(err.message.includes("HF_BOT_TOKEN"), false);
    const result = resultFromError(err);
    assert.equal(result.status, 429);
    const body = result.body as { error: { details: { retryAfter?: string } } };
    assert.equal(body.error.details.retryAfter, "30");
    const response = apiResultResponse(result);
    assert.equal(response.headers.get("retry-after"), "30");
  });

  it("defaults Retry-After to 60 seconds when Hugging Face omits the header", () => {
    const err = bountyErrorForHuggingFace(
      new HuggingFaceReadError("hf_rate_limited", 429, "slow", null),
      "stanfordnlp/imdb#9",
    );
    assert.equal(err.details?.retryAfter, "60");
    const response = apiResultResponse(resultFromError(err));
    assert.equal(response.headers.get("retry-after"), "60");
  });
});

describe("Hugging Face create flag", () => {
  it("returns hf_disabled before amount checks on the website path", async () => {
    await assert.rejects(
      () =>
        createBountyFromIssueUrl(
          { posterUserId: "user-1", issueUrl: HF_URL, amountUsdc: "nope" },
          { db: {} as never, env: {} },
        ),
      (err: unknown) => err instanceof BountyError && err.code === "hf_disabled",
    );
    await assert.rejects(
      () =>
        createBountyFromIssueUrl(
          { posterUserId: "user-1", issueUrl: HF_URL, amountUsdc: "5" },
          { db: {} as never, env: { HF_BOUNTIES_ENABLED: "true" } },
        ),
      (err: unknown) => err instanceof BountyError && err.code === "hf_disabled",
    );
  });

  it("returns 403 hf_disabled from REST before amount validation", async () => {
    const deps = {
      createBounty: (input: { posterUserId: string; issueUrl: string; amountUsdc: string }) =>
        createBountyFromIssueUrl(input, { db: {} as never, env: {} }),
    } as unknown as AccessDeps;
    await assert.rejects(
      () => handleCreateBounty(principal(), { issueUrl: HF_URL, amountUsdc: "nope" }, deps),
      (err: unknown) => {
        const result = resultFromError(err);
        assert.equal(result.status, 403);
        const body = result.body as { error: { code: string } };
        assert.equal(body.error.code, "hf_disabled");
        return true;
      },
    );
  });

  it("returns hf_disabled from MCP create_bounty", async () => {
    const deps = new Proxy({} as AccessDeps, {
      get(_target, prop) {
        if (prop === "env") return {};
        if (prop === "now") return () => new Date("2026-10-03T00:00:00.000Z");
        if (prop === "insertRequest") return async () => "log-1";
        if (prop === "countRequests") return async () => 1;
        if (prop === "updateRequestStatus") return async () => {};
        if (prop === "createBounty") {
          return (input: { posterUserId: string; issueUrl: string; amountUsdc: string }) =>
            createBountyFromIssueUrl(input, { db: {} as never, env: {} });
        }
        return () => {
          throw new Error(`unexpected dep ${String(prop)}`);
        };
      },
    });
    const server = new McpServer({ name: "github-bounties", version: PUBLIC_API_VERSION });
    const access: McpAccess = {
      principal: principal(),
      deps,
      ip: "127.0.0.1",
      origin: "https://dev.githubbounties.xyz",
    };
    registerAuthedMcpTools(server, access);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "hf-create", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({
      name: "create_bounty",
      arguments: { issueUrl: HF_URL, amountUsdc: "nope" },
    });
    await client.close();
    await server.close();
    assert.equal(result.isError, true);
    const body = JSON.parse(textOf(result)) as { error: { code: string } };
    assert.equal(body.error.code, "hf_disabled");
  });

  it("keeps GitHub URL errors when the flag is on", async () => {
    await assert.rejects(
      () =>
        createBountyFromIssueUrl(
          {
            posterUserId: "user-1",
            issueUrl: "https://github.com/octo/hello/pull/1",
            amountUsdc: "5",
          },
          { db: {} as never, env: { HF_BOUNTIES_ENABLED: "1" } },
        ),
      (err: unknown) => {
        assert.ok(err instanceof BountyError);
        assert.equal(err.code, "invalid_issue_url");
        assert.match(err.message, /huggingface\.co\/datasets\/owner\/repo\/discussions\/1/);
        assert.match(err.message, /huggingface\.co\/spaces\/owner\/repo\/discussions\/1/);
        assert.match(err.message, /github\.com\/owner\/repo\/issues\/123/);
        return true;
      },
    );
    await assert.rejects(
      () =>
        createBountyFromIssueUrl(
          {
            posterUserId: "user-1",
            issueUrl: "https://example.com/not-a-bounty",
            amountUsdc: "5",
          },
          { db: {} as never, env: {} },
        ),
      (err: unknown) => {
        assert.ok(err instanceof BountyError);
        assert.equal(err.code, "invalid_issue_url");
        assert.equal(err.message.includes("huggingface.co"), false);
        return true;
      },
    );
    await assert.rejects(
      () =>
        createBountyFromIssueUrl(
          {
            posterUserId: "user-1",
            issueUrl: "https://github.com/octo/hello/issues/1",
            amountUsdc: "nope",
          },
          { db: {} as never, env: { HF_BOUNTIES_ENABLED: "1" } },
        ),
      (err: unknown) => err instanceof BountyError && err.code === "invalid_amount",
    );
  });
});
