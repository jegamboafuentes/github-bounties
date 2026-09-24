import { publicCorsPreflight } from "@/api/public/cors";
import { handlePublicRead } from "@/api/public/http";
import { buildOpenApiDocument } from "@/api/public/schemas";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handlePublicRead(request, async () => Response.json(buildOpenApiDocument()), { cors: true });
}

export function OPTIONS() {
  return publicCorsPreflight();
}
