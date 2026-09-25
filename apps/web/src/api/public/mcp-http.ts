import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { mcpAccessFromRequest } from "../access/http";
import { PUBLIC_API_CORS_HEADERS, publicCorsPreflight } from "./cors";
import { handlePublicRead } from "./http";
import { createBountiesMcpServer } from "./mcp";
import { publicReadApi } from "./service";

function withMcpCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  for (const [key, value] of Object.entries(PUBLIC_API_CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serveMcp(request: Request, access: Awaited<ReturnType<typeof mcpAccessFromRequest>>): Promise<Response> {
  if (access instanceof Response) return access;
  const server = createBountiesMcpServer(publicReadApi, access.principal ? access : { ...access, principal: null });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

/**
 * Stateless streamable HTTP. A new server and transport per request so Cloud
 * Run does not need sticky sessions. Bearer authenticates the key. No cookies.
 * Anonymous reads stay on the per-IP limiter.
 */
export function handleMcpHttp(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return Promise.resolve(publicCorsPreflight());
  if (!request.headers.get("authorization")?.trim()) {
    return handlePublicRead(request, async () => {
      const server = createBountiesMcpServer(publicReadApi, null);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      return withMcpCors(await transport.handleRequest(request));
    }, { cors: true });
  }
  return (async () => {
    const access = await mcpAccessFromRequest(request);
    return withMcpCors(await serveMcp(request, access));
  })();
}
