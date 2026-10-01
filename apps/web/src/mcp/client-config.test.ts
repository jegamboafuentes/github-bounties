import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { API_KEY_PLACEHOLDER, CURSOR_AUTHORIZATION, mcpConfigSnippets, mcpEndpointUrl } from "./client-config";

const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../app/mcp-page/page.tsx"),
  "utf8",
);

describe("MCP client config", () => {
  it("uses PUBLIC_BASE_URL then AUTH_URL and never a request host", () => {
    assert.equal(
      mcpEndpointUrl({ PUBLIC_BASE_URL: "https://dev.githubbounties.xyz/path" }),
      "https://dev.githubbounties.xyz/mcp",
    );
    assert.equal(
      mcpEndpointUrl({ AUTH_URL: "https://githubbounties.xyz/api/auth" }),
      "https://githubbounties.xyz/mcp",
    );
    assert.equal(
      mcpEndpointUrl({ PUBLIC_BASE_URL: "https://dev.githubbounties.xyz", AUTH_URL: "https://githubbounties.xyz" }),
      "https://dev.githubbounties.xyz/mcp",
    );
    assert.equal(mcpEndpointUrl({ PUBLIC_BASE_URL: "http://0.0.0.0:8080" }), "http://localhost:3000/mcp");
    assert.equal(mcpEndpointUrl({ AUTH_URL: "http://127.0.0.1:3000" }), "http://localhost:3000/mcp");
    assert.equal(mcpEndpointUrl({}), "http://localhost:3000/mcp");
  });

  it("shows a key placeholder in every tab and never a real key", () => {
    const snippets = mcpConfigSnippets({ PUBLIC_BASE_URL: "https://dev.githubbounties.xyz" });
    assert.deepEqual(
      snippets.map((item) => item.filename),
      [".cursor/mcp.json", "claude_desktop_config.json", "mcp.json"],
    );
    const cursor = snippets[0];
    const claude = snippets[1];
    const generic = snippets[2];
    assert.ok(cursor && claude && generic);
    assert.match(cursor.body, /https:\/\/dev\.githubbounties\.xyz\/mcp/);
    assert.match(cursor.body, /Authorization/);
    assert.match(cursor.body, /Bearer \$\{env:GB_API_KEY\}/);
    assert.equal(CURSOR_AUTHORIZATION.includes("gb_"), false);
    assert.match(claude.body, new RegExp(`Bearer ${API_KEY_PLACEHOLDER}`));
    assert.match(generic.body, new RegExp(`Bearer ${API_KEY_PLACEHOLDER}`));
    assert.doesNotMatch(generic.body, /mcpServers/);
    for (const snippet of snippets) {
      assert.equal(JSON.parse(snippet.body) !== null, true);
      assert.doesNotMatch(snippet.body, /gb_(test|live)_/);
    }
  });

  it("the setup page takes the origin from config, not request headers", () => {
    assert.match(pageSource, /mcpEndpointUrl\(process\.env\)/);
    assert.match(pageSource, /listRegisteredMcpTools/);
    assert.doesNotMatch(pageSource, /headers\(/);
    assert.doesNotMatch(pageSource, /x-forwarded-host/);
    assert.doesNotMatch(pageSource, /readPublicSiteOrigin/);
    assert.doesNotMatch(pageSource, /fund_bounty/);
  });
});
