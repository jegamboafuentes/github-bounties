import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listRegisteredMcpTools } from "./mcp-catalog";

describe("MCP tool catalog", () => {
  it("reads name and description from the live registry", async () => {
    const tools = await listRegisteredMcpTools();
    assert.equal(tools.length, 25);
    assert.equal(new Set(tools.map((tool) => tool.name)).size, 25);
    for (const tool of tools) {
      assert.equal(tool.name.length > 0, true);
      assert.equal(tool.description.length > 0, true);
      assert.equal(tool.summary.length > 0, true);
      assert.equal(["public", "read", "write", "money"].includes(tool.scope), true);
    }
    assert.equal(tools.find((tool) => tool.name === "list_bounties")?.scope, "public");
    assert.equal(tools.find((tool) => tool.name === "get_me")?.scope, "read");
    assert.equal(tools.find((tool) => tool.name === "refund_bounty")?.scope, "money");
    assert.equal(
      tools.some((tool) => tool.name === "list_bounties"),
      true,
    );
    assert.equal(
      tools.some((tool) => tool.name === "refund_bounty"),
      true,
    );
    assert.equal(
      tools.some((tool) => tool.name === "update_bounty_amount"),
      true,
    );
  });
});
