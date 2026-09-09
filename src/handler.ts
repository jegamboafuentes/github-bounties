import { evaluateEligibility } from "./eligibility.js";
import type { DeliveryStore } from "./delivery-store.js";
import type {
  EligibilityDecision,
  GitHubWebhookPayload,
  HandleResult,
  PullRequestSurface,
} from "./types.js";

export type HandlerDeps = {
  store: DeliveryStore;
  log?: (line: string) => void;
};

/**
 * Process one verified GitHub delivery.
 *
 * Side effect on first sight of a delivery: logs
 * `would mark claim eligible` when the merged-PR-closes-#N predicate holds.
 * Never moves money.
 *
 * Replay of the same `X-GitHub-Delivery` is a no-op (idempotent).
 */
export function handleDelivery(args: {
  deliveryId: string;
  event: string;
  payload: GitHubWebhookPayload;
  deps: HandlerDeps;
}): HandleResult {
  const { deliveryId, event, payload, deps } = args;
  const logs: string[] = [];
  const emit = (line: string) => {
    logs.push(line);
    (deps.log ?? console.log)(line);
  };

  const existing = deps.store.get(deliveryId);
  if (existing) {
    emit(`[idempotency] skip duplicate delivery ${deliveryId}`);
    return {
      duplicate: true,
      deliveryId,
      event,
      decision: existing.decision,
      logs,
    };
  }

  if (event === "ping") {
    emit(`[webhook] ping ok delivery=${deliveryId}`);
    deps.store.recordIfNew({
      deliveryId,
      receivedAt: new Date().toISOString(),
      event,
    });
    return { duplicate: false, deliveryId, event, logs };
  }

  if (event === "installation") {
    emit(
      `[webhook] installation ${payload.action ?? "unknown"} delivery=${deliveryId} installation=${payload.installation?.id ?? "?"} (claim-expiry jobs: treat uninstall as pause)`,
    );
    deps.store.recordIfNew({
      deliveryId,
      receivedAt: new Date().toISOString(),
      event,
      action: payload.action,
    });
    return { duplicate: false, deliveryId, event, logs };
  }

  const decision = evaluateEligibility(toEligibilityInput(event, payload));

  const inserted = deps.store.recordIfNew({
    deliveryId,
    receivedAt: new Date().toISOString(),
    event,
    action: payload.action,
    decision,
  });

  if (!inserted) {
    emit(`[idempotency] skip duplicate delivery ${deliveryId}`);
    return {
      duplicate: true,
      deliveryId,
      event,
      decision,
      logs,
    };
  }

  if (decision.eligible) {
    for (const issueNumber of decision.closedIssueNumbers) {
      emit(wouldMarkLine({ deliveryId, decision, issueNumber }));
    }
  } else {
    emit(
      `[eligibility] skip repo=${decision.repositoryFullName || "(unknown)"} pr=#${decision.pullRequestNumber ?? "?"} delivery=${deliveryId} reason=${decision.reason}`,
    );
  }

  return { duplicate: false, deliveryId, event, decision, logs };
}

export function wouldMarkLine(args: {
  deliveryId: string;
  decision: EligibilityDecision;
  issueNumber: number;
}): string {
  return `[eligibility] would mark claim eligible repo=${args.decision.repositoryFullName} issue=#${args.issueNumber} pr=#${args.decision.pullRequestNumber} winner=${args.decision.winnerLogin ?? "?"} delivery=${args.deliveryId}`;
}

export function toEligibilityInput(
  event: string,
  payload: GitHubWebhookPayload,
) {
  const repositoryFullName =
    payload.repository?.full_name ??
    payload.pull_request?.base?.repo?.full_name ??
    "";
  const defaultBranch =
    payload.repository?.default_branch ??
    payload.pull_request?.base?.repo?.default_branch ??
    "";

  let pullRequest: PullRequestSurface | undefined;
  const rawPr = payload.pull_request;
  const prNumber = rawPr?.number;
  if (rawPr && prNumber != null) {
    pullRequest = {
      number: prNumber,
      title: rawPr.title ?? "",
      body: rawPr.body ?? "",
      merged: Boolean(rawPr.merged),
      authorLogin: rawPr.user?.login ?? "",
      baseRef: rawPr.base?.ref ?? "",
    };
  }

  return {
    event,
    action: payload.action,
    repositoryFullName,
    defaultBranch,
    pullRequest,
  };
}
