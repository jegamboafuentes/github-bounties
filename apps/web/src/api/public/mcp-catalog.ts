import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MONEY_ACTIONS_DISABLED } from "../access/money-wording";
import { createBountiesMcpServer } from "./mcp";
import type { PublicReadApi } from "./service";

export type McpToolScope = "public" | "read" | "write" | "money" | "admin";

export type McpToolSummary = {
  name: string;
  description: string;
  /** First sentence of the registry description, after the scope lead. */
  summary: string;
  scope: McpToolScope;
};

export function mcpToolScope(description: string): McpToolScope {
  if (description.startsWith("Requires API key (admin scope).")) return "admin";
  if (description.startsWith("Requires API key (read scope).")) return "read";
  if (description.startsWith("Requires API key (write scope).")) return "write";
  if (description.startsWith("Requires API key with money scope.")) return "money";
  return "public";
}

/** One sentence from the registry text. The required-scope lead is not repeated. */
export function mcpToolOneLiner(description: string): string {
  let rest = description.replace(/^Requires API key \((?:read|write|admin) scope\)\.\s*/, "");
  rest = rest.replace(/^Requires API key with money scope\.\s*/, "");
  if (rest.startsWith(MONEY_ACTIONS_DISABLED)) {
    rest = rest.slice(MONEY_ACTIONS_DISABLED.length).replace(/^\s*/, "");
  }
  const sentence = rest.split(/(?<=[.!?])\s+/)[0] ?? rest;
  return sentence.trim();
}

const catalogApi: PublicReadApi = {
  async listBounties() {
    throw new Error("The MCP catalog lists tools and does not call them.");
  },
  async getBounty() {
    throw new Error("The MCP catalog lists tools and does not call them.");
  },
  async listFunders() {
    throw new Error("The MCP catalog lists tools and does not call them.");
  },
  async getIntelligence() {
    throw new Error("The MCP catalog lists tools and does not call them.");
  },
  async getStats() {
    throw new Error("The MCP catalog lists tools and does not call them.");
  },
};

/**
 * Name and description of every tool on the live MCP server, in registry
 * order. Listing does not run a tool handler.
 */
export async function listRegisteredMcpTools(): Promise<McpToolSummary[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBountiesMcpServer(catalogApi);
  const client = new Client({ name: "github-bounties-mcp", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    return listed.tools.map((tool) => {
      const description = tool.description ?? "";
      return {
        name: tool.name,
        description,
        summary: mcpToolOneLiner(description),
        scope: mcpToolScope(description),
      };
    });
  } finally {
    await client.close();
    await server.close();
  }
}
