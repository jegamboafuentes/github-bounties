import type { EnvMap } from "@/auth/env";
import { configuredPublicOrigin, LOCAL_SITE_ORIGIN } from "@/lib/site-env";

/** Shown in snippets. Never a real `gb_test_` or `gb_live_` key. */
export const API_KEY_PLACEHOLDER = "YOUR_API_KEY";

/** Cursor reads the key from the environment. Same header shape as the docs snippet. */
export const CURSOR_AUTHORIZATION = "Bearer ${env:GB_API_KEY}";

export const CLAUDE_AUTHORIZATION = `Bearer ${API_KEY_PLACEHOLDER}`;

/**
 * MCP URL origin: `PUBLIC_BASE_URL`, then `AUTH_URL`, skipping loopback and
 * bind addresses the same way the sign-in redirect does. Never the request host.
 * A missing public origin uses the local constant, not an incoming header.
 */
export function mcpPublicOrigin(env: EnvMap = process.env): string {
  return configuredPublicOrigin(env) ?? LOCAL_SITE_ORIGIN;
}

export function mcpEndpointUrl(env: EnvMap = process.env): string {
  return `${mcpPublicOrigin(env)}/mcp`;
}

export type McpConfigTabId = "cursor" | "claude" | "generic";

export type McpConfigSnippet = {
  id: McpConfigTabId;
  label: string;
  filename: string;
  body: string;
};

function servers(url: string, authorization: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "github-bounties": {
          url,
          headers: { Authorization: authorization },
        },
      },
    },
    null,
    2,
  );
}

export function mcpConfigSnippets(env: EnvMap = process.env): McpConfigSnippet[] {
  const url = mcpEndpointUrl(env);
  return [
    {
      id: "cursor",
      label: "Cursor",
      filename: ".cursor/mcp.json",
      body: servers(url, CURSOR_AUTHORIZATION),
    },
    {
      id: "claude",
      label: "Claude Desktop",
      filename: "claude_desktop_config.json",
      body: servers(url, CLAUDE_AUTHORIZATION),
    },
    {
      id: "generic",
      label: "Generic MCP",
      filename: "mcp.json",
      body: JSON.stringify(
        {
          url,
          headers: { Authorization: CLAUDE_AUTHORIZATION },
        },
        null,
        2,
      ),
    },
  ];
}
