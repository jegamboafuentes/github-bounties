import { developersToMcpRedirect } from "@/mcp/developers-redirect";

export const dynamic = "force-dynamic";

function respond(request: Request): Response {
  return developersToMcpRedirect(new URL(request.url)) ?? new Response(null, { status: 404 });
}

export const GET = respond;
export const POST = respond;
export const PUT = respond;
export const PATCH = respond;
export const DELETE = respond;
export const HEAD = respond;
export const OPTIONS = respond;
