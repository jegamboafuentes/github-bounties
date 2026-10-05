import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, bountySubmissions, repos, type HfRepoType } from "../db/schema";
import type { GitHubHttp } from "../github/api";
import { hfBountiesEnabled, isHuggingFaceReadError } from "../providers/huggingface";
import { applyHuggingFaceMerge, hfPollDeliveryId } from "../huggingface/apply-merge";
import { ensureHfRepoWatched } from "../huggingface/watch";
import { FUNDED_BOUNTY_STATUSES } from "../webhooks/claims";

export type HfMergePollResult = {
  scanned: number;
  eligible: number;
  claimsWritten: number;
  duplicates: number;
  skipped?: "hf_disabled";
  errors: Array<{ bountyId: string; message: string }>;
};

type PollRow = {
  bountyId: string;
  prNumber: number;
  fullName: string;
  repoType: HfRepoType;
  owner: string;
  repo: string;
};

/**
 * Safety net for Hugging Face merges. Re-reads each submitted pull request on
 * an open funded Hugging Face bounty and runs the same eligibility path as
 * POST /webhooks/huggingface. Flag off: no Hub call and no claim.
 * This repo does not create the Cloud Scheduler job.
 */
export async function pollHfMerges(
  db: Database,
  opts: { http?: GitHubHttp; env?: NodeJS.ProcessEnv; log?: (line: string) => void } = {},
): Promise<HfMergePollResult> {
  const env = opts.env ?? process.env;
  if (!hfBountiesEnabled(env)) {
    return { scanned: 0, eligible: 0, claimsWritten: 0, duplicates: 0, skipped: "hf_disabled", errors: [] };
  }
  const rows = await db
    .select({
      bountyId: bounties.id,
      prNumber: bountySubmissions.prNumber,
      fullName: repos.fullName,
      repoType: repos.hfRepoType,
    })
    .from(bountySubmissions)
    .innerJoin(bounties, eq(bounties.id, bountySubmissions.bountyId))
    .innerJoin(repos, eq(repos.id, bounties.repoId))
    .where(
      and(
        eq(bountySubmissions.status, "submitted"),
        eq(bounties.provider, "huggingface"),
        inArray(bounties.status, [...FUNDED_BOUNTY_STATUSES]),
        isNull(bounties.deletedAt),
        eq(repos.provider, "huggingface"),
      ),
    );

  const result: HfMergePollResult = {
    scanned: rows.length,
    eligible: 0,
    claimsWritten: 0,
    duplicates: 0,
    errors: [],
  };
  const targets: PollRow[] = [];
  for (const row of rows) {
    if (row.repoType !== "model" && row.repoType !== "dataset" && row.repoType !== "space") {
      result.errors.push({ bountyId: row.bountyId, message: `repo ${row.fullName} has no Hugging Face type` });
      continue;
    }
    const [owner, repo, extra] = row.fullName.split("/");
    if (!owner || !repo || extra) {
      result.errors.push({ bountyId: row.bountyId, message: `repo full name ${row.fullName} is not owner/repo` });
      continue;
    }
    targets.push({
      bountyId: row.bountyId,
      prNumber: row.prNumber,
      fullName: row.fullName,
      repoType: row.repoType,
      owner,
      repo,
    });
  }

  const watched = new Set<string>();
  for (const target of targets) {
    const key = `${target.repoType}:${target.fullName.toLowerCase()}`;
    if (watched.has(key)) continue;
    watched.add(key);
    const watch = await ensureHfRepoWatched(
      { type: target.repoType, fullName: target.fullName },
      { http: opts.http, env, log: opts.log },
    );
    if (watch.reason === "failed") {
      result.errors.push({ bountyId: target.bountyId, message: `watch sync failed for ${target.fullName}` });
    }
  }

  for (const target of targets) {
    try {
      const applied = await applyHuggingFaceMerge(
        db,
        {
          deliveryId: hfPollDeliveryId(target.repoType, target.fullName, target.prNumber),
          event: "hf.poll",
          action: `poll:${target.repoType}`,
          refresh: true,
          target: {
            repoType: target.repoType,
            owner: target.owner,
            repo: target.repo,
            prNumber: target.prNumber,
          },
        },
        { http: opts.http, env },
      );
      if (applied.eligible) result.eligible += 1;
      result.claimsWritten += applied.claimsWritten;
      if (applied.duplicate) result.duplicates += 1;
    } catch (err) {
      const message = isHuggingFaceReadError(err)
        ? err.code
        : err instanceof Error
          ? err.message
          : "poll failed";
      result.errors.push({ bountyId: target.bountyId, message });
    }
  }
  return result;
}
