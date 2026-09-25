import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBountiesMcpServer } from "./mcp";
import type { PublicReadApi } from "./service";

export type McpToolSummary = {
  name: string;
  description: string;
};

const catalogApi: PublicReadApi = {
  async listBounties() {
    throw new Error("The developers catalog lists tools and does not call them.");
  },
  async getBounty() {
    throw new Error("The developers catalog lists tools and does not call them.");
  },
  async listFunders() {
    throw new Error("The developers catalog lists tools and does not call them.");
  },
  async getIntelligence() {
    throw new Error("The developers catalog lists tools and does not call them.");
  },
  async getStats() {
    throw new Error("The developers catalog lists tools and does not call them.");
  },
};

/**
 * Name and description of every tool on the live MCP server, in registry
 * order. Listing does not run a tool handler.
 */
export async function listRegisteredMcpTools(): Promise<McpToolSummary[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBountiesMcpServer(catalogApi);
  const client = new Client({ name: "github-bounties-developers", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    return listed.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
    }));
  } finally {
    await client.close();
    await server.close();
  }
}
