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
