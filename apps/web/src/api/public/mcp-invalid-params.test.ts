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
import { logMcpToolCall, runLoggedMcpTool } from "./mcp-log";

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
    assert.equal(toolClassForMcpTool("get_profile"), "read");
    assert.equal(toolClassForMcpTool("update_profile"), "write");
    assert.equal(toolClassForMcpTool("update_notification_preferences"), "write");
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

  it("logs one mcp_tool_call line without arguments and records a keyed public read", async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    const requests: { route: string; keyId: string; userId: string }[] = [];
    const deps = {
      env: {},
      now: () => new Date("2026-09-25T00:00:00.000Z"),
      insertRequest: async (row: { route: string; keyId: string; userId: string }) => {
        requests.push({ route: row.route, keyId: row.keyId, userId: row.userId });
        return "log-1";
      },
      countRequests: async () => 1,
      updateRequestStatus: async () => {},
    } as unknown as AccessDeps;
    try {
      logMcpToolCall({
        tool: "get_bounty",
        apiKeyId: "key-1",
        userId: "user-1",
        outcome: "ok",
        latencyMs: 4,
        rateClass: "read",
      });
      const secret = "0xsecret-argument-must-not-appear";
      const result = await runLoggedMcpTool({
        tool: "list_bounties",
        rateClass: "read",
        access: {
          principal: principal(),
          deps,
          ip: "127.0.0.1",
          origin: "https://dev.githubbounties.xyz",
        },
        recordRequest: true,
        run: async () => ({ data: [], note: secret }),
      });
      assert.equal(result.isError, false);
      const text = (result.content[0] as { text?: string }).text ?? "";
      assert.match(text, /secret-argument/);
    } finally {
      console.log = original;
    }
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(logged.length, 2);
    for (const row of logged) {
      assert.deepEqual(Object.keys(row).sort(), [
        "apiKeyId",
        "event",
        "latencyMs",
        "outcome",
        "rateClass",
        "tool",
        "userId",
      ]);
      assert.equal(JSON.stringify(row).includes("secret-argument"), false);
      assert.equal(JSON.stringify(row).includes("arguments"), false);
    }
    assert.equal(logged[1]?.tool, "list_bounties");
    assert.equal(logged[1]?.outcome, "ok");
    assert.equal(logged[1]?.apiKeyId, "key-1");
    assert.equal(logged[1]?.userId, "user-1");
    assert.equal(logged[1]?.rateClass, "read");
    assert.equal(typeof logged[1]?.latencyMs, "number");
    assert.deepEqual(requests, [{ route: "read tool:list_bounties", keyId: "key-1", userId: "user-1" }]);
  });

  it("logs mcp_tool_call and api_request_log for the profile tools", async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    const requests: { route: string; keyId: string; userId: string }[] = [];
    const deps = {
      env: {},
      now: () => new Date("2026-09-25T00:00:00.000Z"),
      insertRequest: async (row: { route: string; keyId: string; userId: string }) => {
        requests.push({ route: row.route, keyId: row.keyId, userId: row.userId });
        return "log-1";
      },
      countRequests: async () => 1,
      updateRequestStatus: async () => {},
      loadAccountProfile: async () => ({
        id: "user-1",
        displayName: "Ada",
        displayNameCustom: false,
        email: "ada@example.com",
      }),
    } as unknown as AccessDeps;
    const server = new McpServer({ name: "github-bounties", version: "4.4.0" });
    const access: McpAccess = {
      principal: principal(),
      deps,
      ip: "127.0.0.1",
      origin: "https://dev.githubbounties.xyz",
    };
    registerAuthedMcpTools(server, access);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "profile-log", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const wallet = "0x1111111111111111111111111111111111111111";
    try {
      const read = await client.callTool({ name: "get_profile", arguments: {} });
      assert.equal(read.isError, false);
      const write = await client.callTool({
        name: "update_profile",
        arguments: { displayName: "Ada Lovelace", walletAddress: wallet },
      });
      assert.equal(write.isError, true);
      const writeBody = JSON.parse(textOf(write)) as { error: { code: string } };
      assert.equal(writeBody.error.code, "wallet_change_human_only");
    } finally {
      console.log = original;
      await client.close();
      await server.close();
    }
    const logged = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((row) => row.event === "mcp_tool_call");
    assert.deepEqual(
      logged.map((row) => ({ tool: row.tool, outcome: row.outcome, apiKeyId: row.apiKeyId, rateClass: row.rateClass })),
      [
        { tool: "get_profile", outcome: "ok", apiKeyId: "key-1", rateClass: "read" },
        { tool: "update_profile", outcome: "wallet_change_human_only", apiKeyId: "key-1", rateClass: "write" },
      ],
    );
    for (const row of logged) {
      assert.equal(JSON.stringify(row).includes(wallet), false);
      assert.equal(JSON.stringify(row).includes("displayName"), false);
    }
    assert.deepEqual(requests, [
      { route: "read tool:get_profile", keyId: "key-1", userId: "user-1" },
      { route: "write tool:update_profile", keyId: "key-1", userId: "user-1" },
    ]);
  });
});
