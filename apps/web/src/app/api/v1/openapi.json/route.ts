import { handleV1Get } from "@/api/access/http";
import { publicCorsPreflight } from "@/api/public/cors";
import { methodNotAllowed } from "@/api/public/methods";
import { buildOpenApiDocument } from "@/api/public/schemas";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return handleV1Get(request, async () => Response.json(buildOpenApiDocument({ host })));
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
