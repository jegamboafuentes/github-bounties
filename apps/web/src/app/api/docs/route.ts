import { publicCorsPreflight } from "@/api/public/cors";
import { methodNotAllowed } from "@/api/public/methods";
import { DOCS_CSP, swaggerDocsHtml } from "@/api/public/swagger";

export const dynamic = "force-dynamic";

/** Swagger UI. Assets are same-origin under /api/docs/assets. Not session-gated. */
export function GET() {
  return new Response(swaggerDocsHtml(), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": DOCS_CSP,
    },
  });
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
