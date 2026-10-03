import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, repos } from "../db/schema";
import type { GitHubHttp } from "../github/api";
import { fetchPoolPullRequests } from "../github/pool-snapshot";
import { type PublicClosingPull } from "../github/public-read";
import { getProvider } from "../providers/registry";
import { splitFullName } from "./issue-body";
import { FUNDED_BOUNTY_STATUSES, postgresClaimWriter } from "../webhooks/claims";
import { postgresDeliveryRecorder } from "../webhooks/delivery-store";
import { evaluateEligibility } from "../webhooks/eligibility";
import { toEligibilityInput } from "../webhooks/input";
import { postgresPoolWriter, type PoolPullRequestFetcher } from "../webhooks/pool";
import { processDelivery } from "../webhooks/process-delivery";

export type PublicMergePollTarget = {
  bountyId: string;
  provider: string;
  owner: string;
  repo: string;
  fullName: string;
  issueNumber: number;
};

export type PublicMergePollResult = {
  scanned: number;
  eligible: number;
  claimsWritten: number;
  duplicates: number;
  errors: Array<{ bountyId: string; message: string }>;
};

/**
 * Stable id so a later poll (and a hunter Connect backfill) replays the same
 * merge without inserting a second claim. GitHub webhook GUIDs are separate,
 * so an App install that arrives later still runs the webhook path safely.
 */
export function publicMergeDeliveryId(fullName: string, prNumber: number): string {
  return `public-merge:${fullName.toLowerCase()}#${prNumber}`;
}

export { closingPullToWebhookPayload } from "./merge-payload";

/**
 * Find merged PRs that close funded issues on `public_reference` repos and
 * write them through the webhook eligibility path (`evaluateEligibility` →
 * claims → pool freeze). Idempotent per repo + PR number.
 */
export async function pollPublicMerges(
  db: Database,
  opts: {
    http?: GitHubHttp;
    env?: NodeJS.ProcessEnv;
    listClosingPulls?: (target: PublicMergePollTarget) => Promise<PublicClosingPull[]>;
    fetchPullRequests?: PoolPullRequestFetcher;
    log?: (line: string) => void;
  } = {},
): Promise<PublicMergePollResult> {
  const log = opts.log ?? (() => {});
  const rows = await db
    .select({
      bountyId: bounties.id,
      provider: bounties.provider,
      issueNumber: bounties.githubIssueNumber,
      fullName: repos.fullName,
    })
    .from(bounties)
    .innerJoin(repos, eq(repos.id, bounties.repoId))
    .where(
      and(
        eq(repos.connectionKind, "public_reference"),
        inArray(bounties.status, [...FUNDED_BOUNTY_STATUSES]),
        isNull(bounties.deletedAt),
      ),
    );

  const result: PublicMergePollResult = {
    scanned: rows.length,
    eligible: 0,
    claimsWritten: 0,
    duplicates: 0,
    errors: [],
  };

  const groups = new Map<string, PublicMergePollTarget[]>();
  for (const row of rows) {
    const [owner, repo] = splitFullName(row.fullName);
    if (!owner || !repo) {
      result.errors.push({
        bountyId: row.bountyId,
        message: `repo full name ${row.fullName} is not owner/repo`,
      });
      continue;
    }
    const target: PublicMergePollTarget = {
      bountyId: row.bountyId,
      provider: row.provider,
      owner,
      repo,
      fullName: row.fullName,
      issueNumber: row.issueNumber,
    };
    const key = row.fullName.toLowerCase();
    const list = groups.get(key) ?? [];
    list.push(target);
    groups.set(key, list);
  }

  const fetchPullRequests =
    opts.fetchPullRequests ??
    ((args) =>
      fetchPoolPullRequests({
        ...args,
        http: opts.http,
        env: opts.env,
      }));

  for (const targets of groups.values()) {
    const fullName = targets[0]?.fullName;
    if (!fullName) continue;
    const pulls = new Map<number, PublicClosingPull>();
    const issueNumbers = new Set<number>();
    for (const target of targets) {
      issueNumbers.add(target.issueNumber);
      try {
        const provider = getProvider(target.provider);
        const found = opts.listClosingPulls
          ? await opts.listClosingPulls(target)
          : await provider.listClosingPulls({
              owner: target.owner,
              repo: target.repo,
              issueNumber: target.issueNumber,
              http: opts.http,
              env: opts.env,
            });
        for (const pull of found) mergePull(pulls, pull);
      } catch (err) {
        result.errors.push({
          bountyId: target.bountyId,
          message: err instanceof Error ? err.message : "public merge lookup failed",
        });
      }
    }

    for (const pull of pulls.values()) {
      const payload = getProvider(targets[0]?.provider ?? "github").mergeDeliveryPayload(
        fullName,
        pull,
      );
      const decision = evaluateEligibility(toEligibilityInput("pull_request", payload));
      const closesWatched = decision.closedIssueNumbers.some((n) => issueNumbers.has(n));
      if (!decision.eligible || !closesWatched) {
        log(
          `[public-merge] skip repo=${fullName} pr=#${pull.number} reason=${decision.reason}`,
        );
        continue;
      }

      const handled = await processDelivery({
        deliveryId: publicMergeDeliveryId(fullName, pull.number),
        event: "pull_request",
        payload,
        deps: {
          store: postgresDeliveryRecorder(db),
          claims: postgresClaimWriter(db),
          pool: postgresPoolWriter(db, { fetchPullRequests }),
          log,
        },
      });
      result.eligible += 1;
      const pureDuplicate = handled.duplicate && !handled.replayed;
      if (pureDuplicate) result.duplicates += 1;
      else {
        result.claimsWritten += (handled.claims ?? []).filter((row) => row.claimId && !row.skip).length;
      }
      log(
        `[public-merge] repo=${fullName} pr=#${pull.number} eligible=${decision.eligible} duplicate=${handled.duplicate} claims=${handled.claims?.length ?? 0}`,
      );
    }
  }

  return result;
}

function mergePull(into: Map<number, PublicClosingPull>, pull: PublicClosingPull) {
  const prev = into.get(pull.number);
  if (!prev) {
    into.set(pull.number, pull);
    return;
  }
  const closing = [
    ...new Set([...(prev.closingIssueNumbers ?? []), ...(pull.closingIssueNumbers ?? [])]),
  ].sort((a, b) => a - b);
  into.set(pull.number, {
    ...prev,
    ...pull,
    title: pull.title || prev.title,
    body: pull.body || prev.body,
    authorLogin: pull.authorLogin || prev.authorLogin,
    authorId: pull.authorId ?? prev.authorId,
    mergeCommitMessage: pull.mergeCommitMessage ?? prev.mergeCommitMessage,
    commitMessages: pull.commitMessages?.length ? pull.commitMessages : prev.commitMessages,
    closingIssueNumbers: closing.length ? closing : undefined,
  });
}
