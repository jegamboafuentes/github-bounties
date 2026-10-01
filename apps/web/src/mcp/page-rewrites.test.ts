import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mcpDocumentRewrites, mcpPageRewriteDestination } from "./page-rewrites";

function headers(init: Record<string, string>): { get(name: string): string | null } {
  const map = new Map(Object.entries(init).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
}

describe("MCP document rewrites", () => {
  it("sends browser and Next.js document requests to the setup page", () => {
    for (const rule of mcpDocumentRewrites()) {
      assert.equal(rule.source, "/mcp");
      assert.equal(rule.destination, "/mcp-page");
    }
    assert.equal(
      mcpPageRewriteDestination(headers({ accept: "text/html,application/xhtml+xml" })),
      "/mcp-page",
    );
    assert.equal(mcpPageRewriteDestination(headers({ accept: "text/x-component" })), "/mcp-page");
    assert.equal(mcpPageRewriteDestination(headers({ rsc: "1" })), "/mcp-page");
    assert.equal(mcpPageRewriteDestination(headers({ "next-url": "/board" })), "/mcp-page");
  });

  it("leaves streamable HTTP on the protocol route", () => {
    assert.equal(
      mcpPageRewriteDestination(headers({ accept: "application/json, text/event-stream" })),
      null,
    );
    assert.equal(mcpPageRewriteDestination(headers({})), null);
    assert.equal(mcpPageRewriteDestination(headers({ accept: "*/*" })), null);
  });
});
