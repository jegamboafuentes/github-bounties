import { listRegisteredMcpTools } from "./mcp-catalog";
import { buildOpenApiDocument, countOpenApiOperations } from "./schemas";

export type PublicSurfaceCounts = {
  operations: number;
  tools: number;
};

/** OpenAPI operation count for the public document. */
export function openApiOperationCount(): number {
  return countOpenApiOperations(buildOpenApiDocument().paths);
}

/** Live MCP tool count plus the OpenAPI operation count. Neither number is hardcoded. */
export async function publicSurfaceCounts(): Promise<PublicSurfaceCounts> {
  const tools = await listRegisteredMcpTools();
  return { operations: openApiOperationCount(), tools: tools.length };
}

export function surfaceCountPhrase(counts: PublicSurfaceCounts): string {
  const operations = counts.operations === 1 ? "operation" : "operations";
  const tools = counts.tools === 1 ? "tool" : "tools";
  return `${counts.operations} ${operations}, ${counts.tools} ${tools}`;
}
