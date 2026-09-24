import { publicCorsPreflight } from "@/api/public/cors";
import { handlePublicRead } from "@/api/public/http";
import { methodNotAllowed } from "@/api/public/methods";
import { buildOpenApiDocument } from "@/api/public/schemas";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return handlePublicRead(
    request,
    async () => Response.json(buildOpenApiDocument({ host })),
    { cors: true },
  );
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
