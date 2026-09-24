import { handleMcpHttp } from "@/api/public/mcp-http";

export const dynamic = "force-dynamic";

/** Stateless MCP streamable HTTP. No session cookie. Bearer API keys only. */
export function GET(request: Request) {
  return handleMcpHttp(request);
}

export function POST(request: Request) {
  return handleMcpHttp(request);
}

export function DELETE(request: Request) {
  return handleMcpHttp(request);
}
