import { handleV1Get } from "@/api/access/http";
import { publicCorsPreflight } from "@/api/public/cors";
import { methodNotAllowed } from "@/api/public/methods";
import { buildOpenApiDocument } from "@/api/public/schemas";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleV1Get(request, async () => Response.json(buildOpenApiDocument()));
}

export function OPTIONS() {
  return publicCorsPreflight();
}

export function POST() {
  return methodNotAllowed();
}

export function PUT() {
  return methodNotAllowed();
}

export function PATCH() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}
