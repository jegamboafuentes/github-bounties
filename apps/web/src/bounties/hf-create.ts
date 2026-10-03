import type { Database } from "../db/client";
import { bounties, escrows } from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import type { GitHubHttp } from "../github/api";
import {
  HuggingFaceReadError,
  isHuggingFaceReadError,
} from "../providers/huggingface";
import { upsertHuggingFaceRepo } from "../providers/hf-repo";
import { getProvider } from "../providers/registry";
import type { IssueRef } from "../providers/types";
import { readPlatformSettings } from "../admin/settings";
import { DEFAULT_CHAIN, DEFAULT_CURRENCY } from "../lib/constants";
import { normalizeBountyAmountUsdc } from "./amount";
import type { CreateBountyInput, CreatedBounty } from "./create";
import { BountyError } from "./errors";
import { clipIssueBody } from "./markdown";

/**
 * Same pending_fund insert, amount rules, and fee snapshot as a GitHub bounty.
 * The discussion number is stored in `github_issue_number`. Merge and payout
 * are not written here.
 */
export async function createHuggingFaceBounty(
  input: CreateBountyInput,
  ref: IssueRef,
  opts: {
    db: Database;
    http?: GitHubHttp;
    env?: NodeJS.ProcessEnv;
  },
): Promise<CreatedBounty> {
  const type = ref.hfRepoType;
  if (!type) {
    throw new BountyError("hf_unavailable", "Hugging Face discussion is missing a repo type.");
  }
  const amountUsdc = normalizeBountyAmountUsdc(input.amountUsdc);
  let fetched;
  try {
    fetched = await getProvider("huggingface").fetchIssue(ref, {
      http: opts.http,
      env: opts.env,
    });
  } catch (err) {
    if (err instanceof BountyError) throw err;
    if (isHuggingFaceReadError(err)) {
      throw bountyErrorForHuggingFace(err, `${ref.fullName}#${ref.issueNumber}`);
    }
    throw new BountyError(
      "hf_unavailable",
      `Hugging Face could not be reached for ${ref.fullName}#${ref.issueNumber}.`,
    );
  }

  if (fetched.pullRequest || fetched.state.toLowerCase() !== "open") {
    throw new BountyError(
      fetched.pullRequest ? "hf_not_a_discussion" : "hf_discussion_closed",
      fetched.pullRequest
        ? `${ref.fullName}#${ref.issueNumber} is a pull request. Bounties attach to Hugging Face discussions, not pull requests.`
        : `${ref.fullName}#${ref.issueNumber} is not an open discussion.`,
    );
  }

  const repoType = fetched.repo.hfRepoType ?? type;
  const fullName = fetched.repo.fullName || ref.fullName;
  const [owner, repoName] = fullName.split("/");
  const canonical = owner && repoName ? `${owner}/${repoName}` : ref.fullName;
  const url = fetched.htmlUrl || ref.url;
  const title = input.title?.trim() || fetched.title.trim() || `${canonical}#${ref.issueNumber}`;
  const descriptionSnapshot = clipIssueBody(input.description?.trim() || fetched.body || null);
  const repo = await upsertHuggingFaceRepo({
    userId: input.posterUserId,
    hfRepoType: repoType,
    fullName: canonical,
    db: opts.db,
  });

  try {
    const created = await opts.db.transaction(async (tx) => {
      const database = tx as unknown as Database;
      const rates = await readPlatformSettings(database);
      const [row] = await tx
        .insert(bounties)
        .values({
          repoId: repo.id,
          provider: "huggingface",
          githubIssueNumber: ref.issueNumber,
          url,
          posterUserId: input.posterUserId,
          amountUsdc,
          currency: DEFAULT_CURRENCY,
          chain: DEFAULT_CHAIN,
          status: "pending_fund",
          title,
          descriptionSnapshot,
          issueBodySyncedAt: new Date(),
          feeBps: rates.feeBps,
          participationPoolBps: rates.poolBps,
        })
        .returning({
          id: bounties.id,
          repoId: bounties.repoId,
          githubIssueNumber: bounties.githubIssueNumber,
          url: bounties.url,
          status: bounties.status,
          title: bounties.title,
          amountUsdc: bounties.amountUsdc,
          provider: bounties.provider,
        });
      if (!row) throw new Error("insert bounty returned no row");
      await tx.insert(escrows).values({
        bountyId: row.id,
        amountUsdc,
        status: "pending",
      });
      return row;
    });

    return {
      id: created.id,
      repoId: created.repoId,
      githubIssueNumber: created.githubIssueNumber,
      url: created.url,
      status: "pending_fund",
      title: created.title,
      amountUsdc: created.amountUsdc,
      provider: "huggingface",
    };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new BountyError(
        "bounty_exists",
        `An active bounty already exists for ${canonical}#${ref.issueNumber}.`,
      );
    }
    throw err;
  }
}

export function bountyErrorForHuggingFace(err: HuggingFaceReadError, ref: string): BountyError {
  switch (err.code) {
    case "hf_discussion_not_found":
      return new BountyError(
        "hf_discussion_not_found",
        `${ref} was not found. Check the discussion URL. Private Hugging Face repos stay hidden.`,
      );
    case "hf_not_a_discussion":
      return new BountyError(
        "hf_not_a_discussion",
        `${ref} is a pull request. Bounties attach to Hugging Face discussions, not pull requests.`,
      );
    case "hf_discussion_closed":
      return new BountyError(
        "hf_discussion_closed",
        `${ref} is closed or merged. Post a bounty on an open discussion.`,
      );
    case "hf_discussion_inaccessible":
      return new BountyError(
        "hf_discussion_inaccessible",
        `${ref} is private or inaccessible. Only public discussions can be posted.`,
      );
    case "hf_rate_limited":
      return new BountyError(
        "hf_rate_limited",
        "Hugging Face rate limit reached while reading this discussion. Set HF_BOT_TOKEN or retry in a few minutes.",
      );
    case "hf_timeout":
      return new BountyError("hf_timeout", "Hugging Face did not respond in time. Try the discussion URL again.");
    default:
      return new BountyError(
        "hf_unavailable",
        `Hugging Face could not be reached for ${ref}${err.status ? ` (HTTP ${err.status})` : ""}.`,
      );
  }
}
