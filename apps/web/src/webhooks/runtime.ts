import { getRuntimeDb } from "../db/runtime";
import { deactivateReposForInstallation } from "../github/persist";
import { fetchMergeSurfaces } from "../github/api";
import { postgresClaimWriter } from "./claims";
import { postgresDeliveryRecorder } from "./delivery-store";
import { missingGitHubAppApiEnv } from "./env";
import { applySurfaceOverrides } from "./input";
import { processDelivery, type ProcessDeliveryDeps } from "./process-delivery";
import type { EligibilityInput, GitHubWebhookPayload } from "./types";

export function productWebhookDeps(): ProcessDeliveryDeps {
  const db = getRuntimeDb();
  return {
    store: postgresDeliveryRecorder(db),
    claims: postgresClaimWriter(db),
    deactivateInstallation: (installationId) =>
      deactivateReposForInstallation(installationId, db).then(() => undefined),
    enrich: enrichEligibilitySurfaces,
  };
}

export async function enrichEligibilitySurfaces(
  input: EligibilityInput,
  payload: GitHubWebhookPayload,
): Promise<EligibilityInput> {
  if (missingGitHubAppApiEnv().length > 0) return input;
  const pr = input.pullRequest;
  if (!pr || !input.repositoryFullName.includes("/")) return input;
  const [owner, repo] = input.repositoryFullName.split("/");
  if (!owner || !repo) return input;
  try {
    const extras = await fetchMergeSurfaces({
      owner,
      repo,
      pullNumber: pr.number,
      mergeCommitSha: pr.mergeCommitSha,
      installationId: payload.installation?.id,
    });
    return applySurfaceOverrides(input, extras);
  } catch {
    return input;
  }
}

export function processVerifiedDelivery(args: {
  deliveryId: string;
  event: string;
  payload: GitHubWebhookPayload;
}) {
  return processDelivery({
    ...args,
    deps: productWebhookDeps(),
  });
}
