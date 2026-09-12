import { processDelivery, type ProcessDeliveryDeps } from "./process-delivery";
import { claimSkipReasons } from "./outcome";
import type { GitHubWebhookPayload } from "./types";
import {
  readWebhookSecret,
  webhookMissingSecretBody,
} from "./env";
import { verifyGitHubSignature } from "./verify-signature";

export type WebhookHttpResult = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * Verify + dispatch one POST /webhooks/github.
 * Fail closed when `GITHUB_WEBHOOK_SECRET` is missing.
 */
export async function handleGitHubWebhookRequest(args: {
  rawBody: Buffer;
  signatureHeader?: string;
  deliveryId?: string;
  event?: string;
  secret?: string;
  deps: ProcessDeliveryDeps;
}): Promise<WebhookHttpResult> {
  const secret = args.secret ?? readWebhookSecret();
  if (!secret) {
    return { status: 503, body: webhookMissingSecretBody() };
  }

  if (!verifyGitHubSignature(args.rawBody, args.signatureHeader, secret)) {
    return { status: 401, body: { ok: false, error: "invalid signature" } };
  }

  const deliveryId = args.deliveryId?.trim();
  const event = args.event?.trim();
  if (!deliveryId || !event) {
    return {
      status: 400,
      body: { ok: false, error: "missing X-GitHub-Delivery or X-GitHub-Event" },
    };
  }

  let payload: GitHubWebhookPayload = {};
  if (args.rawBody.length > 0) {
    try {
      payload = JSON.parse(args.rawBody.toString("utf8")) as GitHubWebhookPayload;
    } catch {
      return { status: 400, body: { ok: false, error: "invalid json" } };
    }
  }

  const result = await processDelivery({
    deliveryId,
    event,
    payload,
    deps: args.deps,
  });

  const claims = result.claims ?? [];
  return {
    status: 200,
    body: {
      ok: true,
      duplicate: result.duplicate,
      replayed: result.replayed ?? false,
      deliveryId: result.deliveryId,
      event: result.event,
      eligible: result.decision?.eligible ?? false,
      closedIssueNumbers: result.decision?.closedIssueNumbers ?? [],
      winnerLogin: result.decision?.winnerLogin ?? null,
      claims,
      claimSkips: claimSkipReasons(claims),
    },
  };
}

export function headerValue(
  headers: Headers,
  name: string,
): string | undefined {
  return headers.get(name) ?? undefined;
}
