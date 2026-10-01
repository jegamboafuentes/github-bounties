import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleMcpHttp } from "./mcp-http";
import { createBountiesMcpServer } from "./mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

describe("MCP admin visibility and SSE", () => {
  it("returns 405 with Allow when GET asks for a server-sent event stream", async () => {
    const response = await handleMcpHttp(
      new Request("http://localhost/mcp", { method: "GET", headers: { accept: "text/event-stream" } }),
    );
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST, DELETE, OPTIONS");
    assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
    assert.equal(response.headers.get("content-type")?.includes("text/html"), false);
    assert.deepEqual(await response.json(), {
      error: "method_not_allowed",
      message: "Server-sent events are not supported.",
    });
  });

  it("hides admin tools unless the caller is an admin", async () => {
    const api = {
      async listBounties() {
        return { bounties: [], hasMore: false };
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
    async function names(admin: boolean) {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createBountiesMcpServer(api, null, { admin });
      const client = new Client({ name: "test", version: "0" });
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        const listed = await client.listTools();
        return listed.tools.map((tool) => tool.name);
      } finally {
        await client.close();
        await server.close();
      }
    }
    const hidden = await names(false);
    assert.equal(hidden.some((name) => name.startsWith("admin_")), false);
    const shown = await names(true);
    for (const name of [
      "admin_get_settings",
      "admin_set_fee_bps",
      "admin_set_pool_bps",
      "admin_delete_bounty",
      "admin_get_balances",
      "admin_withdraw_fees_preview",
      "admin_withdraw_fees",
    ]) {
      assert.equal(shown.includes(name), true, name);
    }
  });
});
