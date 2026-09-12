import { evaluateEligibility } from "./eligibility";
import { applySurfaceOverrides, toEligibilityInput } from "./input";
import type { DeliveryRecordInput, DeliveryRecorder, StoredDelivery } from "./delivery-store";
import type { ClaimWriter } from "./claims";
import { CLAIM_SKIP, shouldRetryClaimWrites } from "./outcome";
import type {
  ClaimWriteResult,
  EligibilityDecision,
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
 * `X-GitHub-Delivery` is a no-op **when a Claim row was written**.
 *
 * Claim upsert runs **before** the delivery-id insert. If markEligible throws,
 * the delivery is not recorded and GitHub redelivery can retry the Claim write.
 *
 * If the first pass recorded `eligible=true` but every issue skipped (e.g.
 * `hunter_not_linked`), redelivery retries the Claim write so Ops can recover
 * after the hunter Connects GitHub — skip reasons are stored on the delivery.
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
  const retryIncomplete = existing ? shouldRetryClaimWrites(existing) : false;
  if (existing && !retryIncomplete) {
    emit(`[idempotency] skip duplicate delivery ${deliveryId}`);
    return {
      duplicate: true,
      deliveryId,
      event,
      decision: decisionFromStored(existing),
      logs,
      claims: existing.claimResults ?? [],
    };
  }
  if (existing && retryIncomplete) {
    emit(
      `[idempotency] retry incomplete claims delivery=${deliveryId} previous_skips=${(existing.claimResults ?? [])
        .map((row) => row.skip ?? "none")
        .join(",") || "unset"}`,
    );
  }

  if (event === "ping") {
    emit(`[webhook] ping ok delivery=${deliveryId}`);
    await persistDelivery(deps.store, {
      deliveryId,
      event,
      action: payload.action,
    }, existing);
    return { duplicate: Boolean(existing), deliveryId, event, logs };
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
    await persistDelivery(deps.store, {
      deliveryId,
      event,
      action: payload.action,
    }, existing);
    return { duplicate: Boolean(existing), deliveryId, event, logs };
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
    if (claimResults.length === 0) {
      claimResults = decision.closedIssueNumbers.map((issueNumber) => ({
        issueNumber,
        skip: CLAIM_SKIP.noClaimWritten,
        prNumber: decision.pullRequestNumber ?? null,
        winnerLogin: decision.winnerLogin ?? null,
      }));
    }
    for (const row of claimResults) {
      if (row.claimId && !row.skip) {
        emit(
          `[eligibility] marked claim eligible repo=${decision.repositoryFullName} issue=#${row.issueNumber} pr=#${decision.pullRequestNumber} winner=${decision.winnerLogin ?? "?"} claim=${row.claimId} delivery=${deliveryId}`,
        );
      } else {
        emit(
          `[eligibility] skip claim repo=${decision.repositoryFullName} issue=#${row.issueNumber} pr=#${decision.pullRequestNumber} winner=${decision.winnerLogin ?? "?"} reason=${row.skip ?? "unknown"} delivery=${deliveryId}`,
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

  const record: DeliveryRecordInput = {
    deliveryId,
    event,
    action: payload.action,
    decision,
    claims: claimResults,
  };

  if (existing) {
    await deps.store.updateOutcome(record);
    return {
      duplicate: true,
      replayed: true,
      deliveryId,
      event,
      decision,
      logs,
      claims: claimResults,
    };
  }

  const inserted = await deps.store.recordIfNew(record);

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

async function persistDelivery(
  store: DeliveryRecorder,
  entry: DeliveryRecordInput,
  existing: StoredDelivery | undefined,
): Promise<void> {
  if (existing) {
    await store.updateOutcome(entry);
    return;
  }
  await store.recordIfNew(entry);
}

function decisionFromStored(existing: StoredDelivery): EligibilityDecision | undefined {
  if (existing.eligible == null && !existing.claimResults?.length) return undefined;
  return {
    eligible: existing.eligible ?? false,
    reason: "duplicate delivery",
    closedIssueNumbers: [
      ...new Set((existing.claimResults ?? []).map((row) => row.issueNumber)),
    ],
    winnerLogin: existing.winnerLogin ?? undefined,
    pullRequestNumber: existing.pullRequestNumber ?? undefined,
    repositoryFullName: existing.repositoryFullName ?? "",
  };
}
