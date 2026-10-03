import { handleResendWebhook } from "@/contacts/resend";
import { getRuntimeDb } from "@/db/runtime";

export const dynamic = "force-dynamic";

/** Resend contact webhooks. Svix signature in svix-id, svix-timestamp, and svix-signature. */
export async function POST(request: Request) {
  const payload = await request.text();
  const result = await handleResendWebhook({
    payload,
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    db: getRuntimeDb(),
  });
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
