import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AccessDeps } from "../access/deps";
import { captureKeyedRateHeaders } from "../access/handlers";
import { keyedRateLimitHeaders, mcpAccessFromRequest } from "../access/http";
import { PUBLIC_API_CORS_HEADERS, publicCorsPreflight } from "./cors";
import { handlePublicRead } from "./http";
import { createBountiesMcpServer } from "./mcp";
import {
  invalidParamsRateHeaders,
  rewriteMcpInvalidParamsResponse,
  toolClassForMcpTool,
  toolNameFromMcpRequest,
} from "./mcp-invalid-params";
import { logMcpToolCall } from "./mcp-log";
import { publicReadApi } from "./service";

function withMcpCors(response: Response, rateHeaders?: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  for (const [key, value] of Object.entries(PUBLIC_API_CORS_HEADERS)) headers.set(key, value);
  for (const [key, value] of Object.entries(rateHeaders ?? {})) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function replayRequest(request: Request, raw: string): Request {
  const init: RequestInit = { method: request.method, headers: request.headers };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = raw;
  return new Request(request.url, init);
}

function parseJson(raw: string): unknown {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
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
 * Anonymous reads stay on the per-IP limiter. A JSON-RPC -32602 (schema
 * rejection before the tool handler) is rewritten to validation_failed with
 * that tool's rate class, uncounted.
 */
export function handleMcpHttp(request: Request, deps?: AccessDeps): Promise<Response> {
  if (request.method === "OPTIONS") return Promise.resolve(publicCorsPreflight());
  return dispatchMcp(request, deps);
}

function logSchemaReject(toolName: string | null, started: number, apiKeyId: string | null, userId: string | null): void {
  if (!toolName) return;
  logMcpToolCall({
    tool: toolName,
    apiKeyId,
    userId,
    outcome: "validation_failed",
    latencyMs: Math.max(0, Date.now() - started),
    rateClass: toolClassForMcpTool(toolName),
  });
}

async function dispatchMcp(request: Request, deps?: AccessDeps): Promise<Response> {
  const started = Date.now();
  const raw = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
  const replay = replayRequest(request, raw);
  const toolName = toolNameFromMcpRequest(parseJson(raw));
  if (!request.headers.get("authorization")?.trim()) {
    return handlePublicRead(
      replay,
      async () => {
        const server = createBountiesMcpServer(publicReadApi, null);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await server.connect(transport);
        const handled = await transport.handleRequest(replay);
        const { response, rewritten } = await rewriteMcpInvalidParamsResponse(handled);
        if (rewritten) logSchemaReject(toolName, started, null, null);
        return withMcpCors(response);
      },
      { cors: true },
    );
  }
  const access = await mcpAccessFromRequest(replay, deps);
  const { value, headers } = await captureKeyedRateHeaders(() => serveMcp(replay, access));
  const { response, rewritten } = await rewriteMcpInvalidParamsResponse(value);
  if (rewritten && !(access instanceof Response)) {
    logSchemaReject(toolName, started, access.principal?.keyId ?? null, access.principal?.userId ?? null);
  }
  const rateHeaders = rewritten
    ? invalidParamsRateHeaders(toolName)
    : Object.keys(headers).length > 0
      ? headers
      : keyedRateLimitHeaders("read");
  return withMcpCors(response, rateHeaders);
}
