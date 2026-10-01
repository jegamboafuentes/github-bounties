import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DELETE as adminDelete } from "../app/api/v1/admin/bounties/[id]/route";
import { POST as adminRefund } from "../app/api/v1/admin/bounties/[id]/refund/route";
import { GET as bountyGet } from "../app/api/bounties/[id]/route";
import { POST as claimPost } from "../app/api/bounties/[id]/claim/route";
import { POST as fundPost } from "../app/api/bounties/[id]/fund/route";
import { POST as refundPost } from "../app/api/bounties/[id]/refund/route";
import { POST as settlePost } from "../app/api/bounties/[id]/settle/route";
import { GET as x402Get, POST as x402Post } from "../app/api/bounties/[id]/x402/route";
import { PATCH as amountPatch } from "../app/api/v1/bounties/[id]/amount/route";
import { POST as cancelPost } from "../app/api/v1/bounties/[id]/cancel/route";
import { POST as v1ClaimPost } from "../app/api/v1/bounties/[id]/claim/route";
import { GET as claimsGet } from "../app/api/v1/bounties/[id]/claims/route";
import { POST as v1FundPost } from "../app/api/v1/bounties/[id]/fund/route";
import { GET as fundersGet } from "../app/api/v1/bounties/[id]/funders/route";
import { GET as intelligenceGet } from "../app/api/v1/bounties/[id]/intelligence/route";
import { POST as v1RefundPost } from "../app/api/v1/bounties/[id]/refund/route";
import { GET as v1BountyGet } from "../app/api/v1/bounties/[id]/route";
import { POST as topUpPost } from "../app/api/v1/bounties/[id]/top-up/route";
import { DELETE as signalDelete, POST as signalPost } from "../app/api/v1/bounties/[id]/work-signal/route";
import { registerAuthedMcpTools } from "../api/access/mcp-tools";
import type { AccessDeps } from "../api/access/deps";
import type { ApiPrincipal } from "../api/access/handlers";
import type { McpAccess } from "../api/access/http";
import { createBountiesMcpServer } from "../api/public/mcp";
import type { PublicReadApi } from "../api/public/service";
import { PublicApiError, publicApiErrorBody } from "../api/public/errors";
import { acceptBountyId } from "../api/public/query";
import { bountyStatusLabel } from "../bounties/display";

const BAD = "not-a-uuid";

function ctx() {
  return { params: Promise.resolve({ id: BAD }) };
}

function assertCleanNotFound(status: number, body: unknown, code: string) {
  assert.equal(status, 404);
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /failed query|select |insert |update |postgres|drizzle/i);
  assert.match(text, new RegExp(code));
}

async function read(response: Response) {
  return { status: response.status, body: await response.json() };
}

describe("public id routes reject not-a-uuid", () => {
  it("acceptBountyId is 404 not_found", () => {
    assert.throws(
      () => acceptBountyId(BAD),
      (err: unknown) => err instanceof PublicApiError && err.code === "not_found" && err.status === 404,
    );
  });

  it("website bounty routes return a clean 404", async () => {
    const origin = "https://dev.githubbounties.xyz";
    const cases: [string, Response][] = [
      ["GET /api/bounties/{id}", await bountyGet(new Request(`${origin}/api/bounties/${BAD}`), ctx())],
      ["GET /api/bounties/{id}/x402", await x402Get(new Request(`${origin}/api/bounties/${BAD}/x402`), ctx())],
      ["POST /api/bounties/{id}/x402", await x402Post(new Request(`${origin}/api/bounties/${BAD}/x402`, { method: "POST" }), ctx())],
      ["POST /api/bounties/{id}/fund", await fundPost(new Request(`${origin}/api/bounties/${BAD}/fund`, { method: "POST", body: "{}" }), ctx())],
      ["POST /api/bounties/{id}/claim", await claimPost(new Request(`${origin}/api/bounties/${BAD}/claim`, { method: "POST", body: "{}" }), ctx())],
      ["POST /api/bounties/{id}/refund", await refundPost(new Request(`${origin}/api/bounties/${BAD}/refund`, { method: "POST" }), ctx())],
      ["POST /api/bounties/{id}/settle", await settlePost(new Request(`${origin}/api/bounties/${BAD}/settle`, { method: "POST" }), ctx())],
    ];
    for (const [name, response] of cases) {
      const { status, body } = await read(response);
      assertCleanNotFound(status, body, "not_found");
      assert.equal((body as { error?: string }).error, "not_found", name);
    }
  });

  it("REST bounty routes return 404 not_found", async () => {
    const origin = "https://dev.githubbounties.xyz";
    const id = BAD;
    const cases: [string, Response][] = [
      ["GET /api/v1/bounties/{id}", await v1BountyGet(new Request(`${origin}/api/v1/bounties/${id}`), ctx())],
      ["GET funders", await fundersGet(new Request(`${origin}/api/v1/bounties/${id}/funders`), ctx())],
      ["GET intelligence", await intelligenceGet(new Request(`${origin}/api/v1/bounties/${id}/intelligence`), ctx())],
      ["GET claims", await claimsGet(new Request(`${origin}/api/v1/bounties/${id}/claims`), ctx())],
      ["POST fund", await v1FundPost(new Request(`${origin}/api/v1/bounties/${id}/fund`, { method: "POST", body: "{}" }), ctx())],
      ["POST top-up", await topUpPost(new Request(`${origin}/api/v1/bounties/${id}/top-up`, { method: "POST", body: "{}" }), ctx())],
      ["POST refund", await v1RefundPost(new Request(`${origin}/api/v1/bounties/${id}/refund`, { method: "POST", body: "{}" }), ctx())],
      ["POST claim", await v1ClaimPost(new Request(`${origin}/api/v1/bounties/${id}/claim`, { method: "POST", body: "{}" }), ctx())],
      ["POST cancel", await cancelPost(new Request(`${origin}/api/v1/bounties/${id}/cancel`, { method: "POST", body: "{}" }), ctx())],
      ["POST work-signal", await signalPost(new Request(`${origin}/api/v1/bounties/${id}/work-signal`, { method: "POST" }), ctx())],
      ["DELETE work-signal", await signalDelete(new Request(`${origin}/api/v1/bounties/${id}/work-signal`, { method: "DELETE" }), ctx())],
      ["PATCH amount", await amountPatch(new Request(`${origin}/api/v1/bounties/${id}/amount`, { method: "PATCH", body: "{}" }), ctx())],
    ];
    for (const [name, response] of cases) {
      const { status, body } = await read(response);
      assertCleanNotFound(status, body, "not_found");
      assert.equal((body as { error?: { code?: string } }).error?.code, "not_found", name);
    }
  });

  it("admin bounty routes return 404 not_found", async () => {
    const origin = "https://dev.githubbounties.xyz";
    const deleted = await read(
      await adminDelete(new Request(`${origin}/api/v1/admin/bounties/${BAD}`, { method: "DELETE" }), ctx()),
    );
    const refunded = await read(
      await adminRefund(new Request(`${origin}/api/v1/admin/bounties/${BAD}/refund`, { method: "POST" }), ctx()),
    );
    assertCleanNotFound(deleted.status, deleted.body, "not_found");
    assertCleanNotFound(refunded.status, refunded.body, "not_found");
    assert.equal((deleted.body as { error?: string }).error, "not_found");
    assert.equal((refunded.body as { error?: string }).error, "not_found");
  });

  it("redacts SQL from a public API error body", () => {
    const body = publicApiErrorBody("internal", "Failed query: select * from bounties", {
      reason: "invalid input syntax for type uuid",
    });
    const text = JSON.stringify(body);
    assert.equal(body.error.message, "Request failed.");
    assert.doesNotMatch(text, /Failed query|select |invalid input syntax/i);
  });

  it("splits funded and claim_locked labels", () => {
    assert.equal(bountyStatusLabel("funded"), "Funded");
    assert.equal(bountyStatusLabel("claim_locked"), "Claim locked");
    assert.notEqual(bountyStatusLabel("funded"), bountyStatusLabel("claim_locked"));
  });
});

describe("MCP not-a-uuid", () => {
  it("get_bounty returns not_found and does not query", async () => {
    const boom = async () => {
      throw new Error("Failed query: select id from bounties");
    };
    const api = {
      listBounties: boom,
      getBounty: boom,
      listFunders: boom,
      getIntelligence: boom,
      getStats: boom,
    } as unknown as PublicReadApi;
    const server = createBountiesMcpServer(api);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "id-guard", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    for (const name of ["get_bounty", "list_funders", "get_bounty_intelligence"] as const) {
      const result = await client.callTool({ name, arguments: { id: BAD } });
      assert.equal(result.isError, true, name);
      const parsed = JSON.parse((result.content[0] as { text: string }).text) as { error: { code: string } };
      assert.equal(parsed.error.code, "not_found", name);
      assert.doesNotMatch(JSON.stringify(result), /Failed query|select /i);
    }
    await client.close();
    await server.close();
  });

  it("fund_bounty returns not_found", async () => {
    const principal: ApiPrincipal = {
      keyId: "key-1",
      userId: "user-1",
      name: "qa",
      env: "test",
      prefix: "gb_test_",
      scopes: new Set(["money"]),
      perTxCapUsdc: "50.000000",
      dailyCapUsdc: "200.000000",
    };
    const deps = new Proxy({} as AccessDeps, {
      get(_target, prop) {
        if (prop === "env") return {};
        if (prop === "now") return () => new Date("2026-10-01T00:00:00Z");
        if (prop === "insertRequest") return async () => "log-1";
        if (prop === "countRequests") return async () => 1;
        if (prop === "updateRequestStatus") return async () => {};
        return () => {
          throw new Error(`Failed query: select ${String(prop)}`);
        };
      },
    });
    const access: McpAccess = {
      principal,
      deps,
      ip: "127.0.0.1",
      origin: "https://dev.githubbounties.xyz",
    };
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "github-bounties", version: "4.5.0" });
    registerAuthedMcpTools(server, access);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "id-guard", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({
      name: "fund_bounty",
      arguments: { id: BAD, idempotencyKey: "bad-id" },
    });
    assert.equal(result.isError, true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as { error: { code: string } };
    assert.equal(parsed.error.code, "not_found");
    assert.doesNotMatch(JSON.stringify(result), /Failed query|select /i);
    await client.close();
    await server.close();
  });

  it("admin_delete_bounty returns not_found", async () => {
    const boom = async () => {
      throw new Error("Failed query: select id from bounties");
    };
    const api = {
      listBounties: boom,
      getBounty: boom,
      listFunders: boom,
      getIntelligence: boom,
      getStats: boom,
    } as unknown as PublicReadApi;
    const server = createBountiesMcpServer(api, null, { admin: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "id-guard", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "admin_delete_bounty", arguments: { bountyId: BAD } });
    assert.equal(result.isError, true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as { error: string };
    assert.equal(parsed.error, "not_found");
    assert.doesNotMatch(JSON.stringify(result), /Failed query|select /i);
    await client.close();
    await server.close();
  });
});
