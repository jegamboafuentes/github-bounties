import { evaluateEligibility } from "./eligibility";
import { applySurfaceOverrides, toEligibilityInput } from "./input";
import type { DeliveryRecorder } from "./delivery-store";
import type { ClaimWriter } from "./claims";
import type {
  ClaimWriteResult,
  EligibilityInput,
  GitHubWebhookPayload,
  HandleResult,
} from "./types";

export type ProcessDeliveryDeps = {
  store: DeliveryRecorder;
  claims?: ClaimWriter;
  log?: (line: string) => void;
  enrich?: (
    input: EligibilityInput,
    payload: GitHubWebhookPayload,
  ) => Promise<EligibilityInput> | EligibilityInput;
  deactivateInstallation?: (installationId: number) => Promise<void>;
};

/**
 * Process one verified GitHub delivery.
 *
 * First sight of a delivery: evaluate merge→close `#N`, and when the repo has
 * a funded bounty, create/update `claims` as `eligible`. Replay of the same
 * `X-GitHub-Delivery` is a no-op.
 *
 * Claim upsert runs **before** the delivery-id insert. If markEligible throws,
 * the delivery is not recorded and GitHub redelivery can retry the Claim write.
 */
export async function processDelivery(args: {
  deliveryId: string;
  event: string;
  payload: GitHubWebhookPayload;
  deps: ProcessDeliveryDeps;
}): Promise<HandleResult> {
  const { deliveryId, event, payload, deps } = args;
  const logs: string[] = [];
  const emit = (line: string) => {
    logs.push(line);
    (deps.log ?? console.log)(line);
  };

  const existing = await deps.store.get(deliveryId);
  if (existing) {
    emit(`[idempotency] skip duplicate delivery ${deliveryId}`);
    return {
      duplicate: true,
      deliveryId,
      event,
      logs,
    };
  }

  if (event === "ping") {
    emit(`[webhook] ping ok delivery=${deliveryId}`);
    await deps.store.recordIfNew({
      deliveryId,
      event,
      action: payload.action,
    });
    return { duplicate: false, deliveryId, event, logs };
  }

  if (event === "installation") {
    const installationId = payload.installation?.id;
    emit(
      `[webhook] installation ${payload.action ?? "unknown"} delivery=${deliveryId} installation=${installationId ?? "?"} (claim-expiry jobs: treat uninstall as pause)`,
    );
    if (
      installationId != null &&
      (payload.action === "deleted" || payload.action === "suspend") &&
      deps.deactivateInstallation
    ) {
      await deps.deactivateInstallation(installationId);
    }
    await deps.store.recordIfNew({
      deliveryId,
      event,
      action: payload.action,
    });
    return { duplicate: false, deliveryId, event, logs };
  }

  let input = toEligibilityInput(event, payload);
  if (deps.enrich) {
    input = await deps.enrich(input, payload);
  }
  if (
    input.pullRequest &&
    !input.pullRequest.mergeCommitMessage &&
    !input.pullRequest.commitMessages &&
    !input.pullRequest.closingIssueNumbers
  ) {
    input = applySurfaceOverrides(input, {});
  }

  const decision = evaluateEligibility(input);

  let claimResults: ClaimWriteResult[] = [];
  if (decision.eligible && deps.claims) {
    claimResults = await deps.claims.markEligible(decision, payload);
    for (const row of claimResults) {
      if (row.claimId) {
        emit(
          `[eligibility] marked claim eligible repo=${decision.repositoryFullName} issue=#${row.issueNumber} pr=#${decision.pullRequestNumber} winner=${decision.winnerLogin ?? "?"} claim=${row.claimId} delivery=${deliveryId}`,
        );
      } else {
        emit(
          `[eligibility] skip claim repo=${decision.repositoryFullName} issue=#${row.issueNumber} pr=#${decision.pullRequestNumber} reason=${row.skip ?? "unknown"} delivery=${deliveryId}`,
        );
      }
    }
  } else if (decision.eligible) {
    for (const issueNumber of decision.closedIssueNumbers) {
      emit(
        `[eligibility] would mark claim eligible repo=${decision.repositoryFullName} issue=#${issueNumber} pr=#${decision.pullRequestNumber} winner=${decision.winnerLogin ?? "?"} delivery=${deliveryId}`,
      );
    }
  } else {
    emit(
      `[eligibility] skip repo=${decision.repositoryFullName || "(unknown)"} pr=#${decision.pullRequestNumber ?? "?"} delivery=${deliveryId} reason=${decision.reason}`,
    );
  }

  const inserted = await deps.store.recordIfNew({
    deliveryId,
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
      claims: claimResults,
    };
  }

  return {
    duplicate: false,
    deliveryId,
    event,
    decision,
    logs,
    claims: claimResults,
  };
}
