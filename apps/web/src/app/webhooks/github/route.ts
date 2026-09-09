import { handleGitHubWebhookRequest, headerValue } from "@/webhooks/http";
import { readWebhookSecret, webhookMissingSecretResponse } from "@/webhooks/env";
import { productWebhookDeps } from "@/webhooks/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-to-server GitHub App webhook. Auth is HMAC, not a Google session. */
export async function POST(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  if (!readWebhookSecret()) {
    return webhookMissingSecretResponse();
  }
  const result = await handleGitHubWebhookRequest({
    rawBody,
    signatureHeader: headerValue(request.headers, "x-hub-signature-256"),
    deliveryId: headerValue(request.headers, "x-github-delivery"),
    event: headerValue(request.headers, "x-github-event"),
    deps: productWebhookDeps(),
  });
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
