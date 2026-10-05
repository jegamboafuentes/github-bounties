import { getRuntimeDb } from "@/db/runtime";
import { handleHuggingFaceWebhook } from "@/huggingface/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Hugging Face Hub webhook. Auth is the X-Webhook-Secret header, not a session.
 * The handler re-reads the discussion API before it writes a claim.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const result = await handleHuggingFaceWebhook(
    { headers: request.headers, body: rawBody },
    { db: getRuntimeDb() },
  );
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
