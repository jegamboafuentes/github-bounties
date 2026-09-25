import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listRegisteredMcpTools } from "./mcp-catalog";

describe("MCP tool catalog", () => {
  it("reads name and description from the live registry", async () => {
    const tools = await listRegisteredMcpTools();
    assert.equal(tools.length, 24);
    assert.equal(new Set(tools.map((tool) => tool.name)).size, 24);
    for (const tool of tools) {
      assert.equal(tool.name.length > 0, true);
      assert.equal(tool.description.length > 0, true);
    }
    assert.equal(
      tools.some((tool) => tool.name === "list_bounties"),
      true,
    );
    assert.equal(
      tools.some((tool) => tool.name === "refund_bounty"),
      true,
    );
  });
});
