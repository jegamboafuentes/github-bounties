import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { handlePublicRead } from "./http";
import { createBountiesMcpServer } from "./mcp";
import { publicReadApi } from "./service";

/**
 * Stateless streamable HTTP. A new server and transport per request so Cloud
 * Run does not need sticky sessions.
 */
export function handleMcpHttp(request: Request): Promise<Response> {
  return handlePublicRead(request, async () => {
    const server = createBountiesMcpServer(publicReadApi);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  });
}
