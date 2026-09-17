import { evaluateEligibility } from "./eligibility";
import { applySurfaceOverrides, toEligibilityInput } from "./input";
import type { DeliveryRecordInput, DeliveryRecorder, StoredDelivery } from "./delivery-store";
import type { ClaimWriter } from "./claims";
import { CLAIM_SKIP, shouldRetryClaimWrites } from "./outcome";
import { isLiveRosterAction, type PoolWriter } from "./pool";
import type {
  ClaimWriteResult,
  EligibilityDecision,
  EligibilityInput,
  GitHubWebhookPayload,
  HandleResult,
  PoolWriteResult,
} from "./types";

export type ProcessDeliveryDeps = {
  store: DeliveryRecorder;
  claims?: ClaimWriter;
  pool?: PoolWriter;
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
 * a funded bounty, create/update `claims` as `eligible`. After the winner is
 * known, freeze pool `E` (V2-2). Replay of the same `X-GitHub-Delivery` is a
 * no-op for claims **when a Claim row was written**, and does not change a
 * freeze that already has `frozen_at`.
 *
 * Claim upsert runs **before** the delivery-id insert. If markEligible throws,
 * the delivery is not recorded and GitHub redelivery can retry the Claim write.
 * Pool freeze errors are logged and do not fail the V1 winner path; redelivery
 * retries freeze until `frozen_at` is set.
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
    const pool = await runPoolSideEffects({
      deliveryId,
      event,
      payload,
      deps,
      emit,
      claimResults: existing.claimResults ?? [],
    });
    const newlyFrozen = pool.some((row) => row.frozen && !row.alreadyFrozen);
    return {
      duplicate: true,
      replayed: newlyFrozen || undefined,
      deliveryId,
      event,
      decision: decisionFromStored(existing),
      logs,
      claims: existing.claimResults ?? [],
      pool,
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

  const decision = await decideEligibility(event, payload, deps);

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

  const pool = await applyPool({
    deliveryId,
    event,
    payload,
    deps,
    emit,
    decision,
    claimResults,
  });

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
      pool,
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
      pool,
    };
  }

  return {
    duplicate: false,
    deliveryId,
    event,
    decision,
    logs,
    claims: claimResults,
    pool,
  };
}

async function decideEligibility(
  event: string,
  payload: GitHubWebhookPayload,
  deps: ProcessDeliveryDeps,
): Promise<EligibilityDecision> {
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
  return evaluateEligibility(input);
}

async function runPoolSideEffects(args: {
  deliveryId: string;
  event: string;
  payload: GitHubWebhookPayload;
  deps: ProcessDeliveryDeps;
  emit: (line: string) => void;
  claimResults: ClaimWriteResult[];
}): Promise<PoolWriteResult[]> {
  if (!args.deps.pool || args.event !== "pull_request") return [];
  const decision = await decideEligibility(args.event, args.payload, args.deps);
  return applyPool({ ...args, decision });
}

async function applyPool(args: {
  deliveryId: string;
  event: string;
  payload: GitHubWebhookPayload;
  deps: ProcessDeliveryDeps;
  emit: (line: string) => void;
  decision: EligibilityDecision;
  claimResults: ClaimWriteResult[];
}): Promise<PoolWriteResult[]> {
  if (!args.deps.pool) return [];
  try {
    if (args.decision.eligible) {
      const rows = await args.deps.pool.freezeAfterWinner({
        decision: args.decision,
        payload: args.payload,
        claimResults: args.claimResults,
      });
      for (const row of rows) {
        if (row.alreadyFrozen) {
          args.emit(
            `[pool] skip freeze already frozen bounty=${row.bountyId ?? "?"} issue=#${row.issueNumber} delivery=${args.deliveryId}`,
          );
        } else if (row.frozen) {
          args.emit(
            `[pool] freeze bounty=${row.bountyId ?? "?"} issue=#${row.issueNumber} paid=${row.paidCount ?? 0} overflow=${row.overflowCount ?? 0} participants=${row.participantCount ?? 0} delivery=${args.deliveryId}`,
          );
        } else {
          args.emit(
            `[pool] skip freeze bounty=${row.bountyId ?? "?"} issue=#${row.issueNumber} reason=${row.skip ?? "unknown"} delivery=${args.deliveryId}`,
          );
        }
      }
      return rows;
    }
    if (isLiveRosterAction(args.event, args.payload.action)) {
      const rows = await args.deps.pool.ingestLiveRoster({
        event: args.event,
        payload: args.payload,
      });
      for (const row of rows) {
        if (row.ingested) {
          args.emit(
            `[pool] ingest candidate bounty=${row.bountyId ?? "?"} issue=#${row.issueNumber} pr=#${args.decision.pullRequestNumber ?? "?"} delivery=${args.deliveryId}`,
          );
        } else if (row.alreadyFrozen) {
          args.emit(
            `[pool] skip ingest frozen bounty=${row.bountyId ?? "?"} issue=#${row.issueNumber} reason=${row.skip ?? "late_pr"} delivery=${args.deliveryId}`,
          );
        }
      }
      return rows;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "pool write failed";
    args.emit(`[pool] failed delivery=${args.deliveryId} err=${message}`);
  }
  return [];
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
