import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAuthedMcpTools } from "../access/mcp-tools";
import type { AccessDeps } from "../access/deps";
import { captureKeyedRateHeaders, type ApiPrincipal } from "../access/handlers";
import type { McpAccess } from "../access/http";
import {
  invalidParamsRateHeaders,
  rewriteInvalidParamsBody,
  toolClassForMcpTool,
  toolNameFromMcpRequest,
} from "./mcp-invalid-params";

const BOUNTY = "b99a9163-4ef8-4f73-b051-e404b569bc17";

function textOf(result: { content: unknown }): string {
  const content = result.content;
  assert.ok(Array.isArray(content));
  const first = content[0] as { type?: string; text?: string };
  return first.text ?? "";
}

function stubDeps(): AccessDeps {
  return new Proxy({} as AccessDeps, {
    get(_target, prop) {
      if (prop === "env") return {};
      if (prop === "now") return () => new Date("2026-09-25T00:00:00.000Z");
      if (prop === "insertRequest") return async () => "log-1";
      if (prop === "countRequests") return async () => 1;
      if (prop === "updateRequestStatus") return async () => {};
      return () => {
        throw new Error(`unexpected dep ${String(prop)}`);
      };
    },
  });
}

function principal(): ApiPrincipal {
  return {
    keyId: "key-1",
    userId: "user-1",
    name: "qa",
    env: "test",
    prefix: "gb_test_",
    scopes: new Set(["read", "write", "money"]),
    perTxCapUsdc: "50.000000",
    dailyCapUsdc: "200.000000",
  };
}

describe("MCP invalid params", () => {
  it("maps tools to their rate class and rewrites JSON-RPC -32602", () => {
    assert.equal(toolClassForMcpTool("refund_bounty"), "money");
    assert.equal(toolClassForMcpTool("create_bounty"), "write");
    assert.equal(toolClassForMcpTool("get_me"), "read");
    assert.equal(invalidParamsRateHeaders("refund_bounty")["RateLimit-Limit"], "10");
    assert.equal(invalidParamsRateHeaders("refund_bounty")["RateLimit-Remaining"], "10");
    assert.equal(invalidParamsRateHeaders("refund_bounty")["RateLimit-Reset"], "3600");
    assert.equal(invalidParamsRateHeaders("create_bounty")["RateLimit-Limit"], "20");
    assert.equal(invalidParamsRateHeaders("get_me")["RateLimit-Limit"], "120");
    assert.equal(
      toolNameFromMcpRequest({ method: "tools/call", params: { name: "refund_bounty" } }),
      "refund_bounty",
    );

    const rewritten = rewriteInvalidParamsBody({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32602, message: "Invalid arguments for tool refund_bounty" },
    }) as { error?: unknown; result?: { isError?: boolean; content?: { text?: string }[] } };
    assert.equal(rewritten.error, undefined);
    assert.equal(rewritten.result?.isError, true);
    const body = JSON.parse(rewritten.result?.content?.[0]?.text ?? "{}") as { error: { code: string } };
    assert.equal(body.error.code, "validation_failed");
  });

  it("returns validation_failed inside the money rate class for an unknown refund argument", async () => {
    const server = new McpServer({ name: "github-bounties", version: "4.3.0" });
    const access: McpAccess = {
      principal: principal(),
      deps: stubDeps(),
      ip: "127.0.0.1",
      origin: "https://dev.githubbounties.xyz",
    };
    registerAuthedMcpTools(server, access);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "invalid-params", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const { value, headers } = await captureKeyedRateHeaders(() =>
      client.callTool({
        name: "refund_bounty",
        arguments: { id: BOUNTY, idempotencyKey: "resume-1", destination: "0x1111111111111111111111111111111111111111" },
      }),
    );
    assert.equal(value.isError, true);
    const body = JSON.parse(textOf(value)) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "validation_failed");
    assert.match(body.error.message, /Unknown argument: destination/);
    assert.equal(headers["RateLimit-Limit"], "10");
    assert.equal(headers["RateLimit-Remaining"], "9");
    assert.equal(headers["RateLimit-Reset"], "3600");

    const read = await captureKeyedRateHeaders(() =>
      client.callTool({ name: "get_me", arguments: { extra: true } }),
    );
    const readBody = JSON.parse(textOf(read.value)) as { error: { code: string } };
    assert.equal(readBody.error.code, "validation_failed");
    assert.equal(read.headers["RateLimit-Limit"], "120");
    assert.equal(read.headers["RateLimit-Reset"], "60");

    await client.close();
    await server.close();
  });
});
