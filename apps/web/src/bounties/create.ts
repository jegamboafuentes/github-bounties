import type { Database } from "../db/client";
import { bounties, escrows } from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import {
  fetchIssue,
  type GitHubHttp,
  type GitHubIssueSnapshot,
} from "../github/api";
import { findActiveRepoByFullName } from "../github/persist";
import { DEFAULT_CHAIN, DEFAULT_CURRENCY } from "../lib/constants";
import { normalizeBountyAmountUsdc } from "./amount";
import { BountyError } from "./errors";
import { parseGitHubIssueUrl } from "./parse-issue-url";

const DESCRIPTION_MAX = 4000;

export type CreateBountyInput = {
  posterUserId: string;
  issueUrl: string;
  amountUsdc: string;
  title?: string;
  description?: string;
};

export type CreatedBounty = {
  id: string;
  repoId: string;
  githubIssueNumber: number;
  url: string;
  status: "pending_fund";
  title: string;
  amountUsdc: string;
};

/**
 * Persist a bounty as `pending_fund` (the form is the draft; schema has no draft status).
 * Repo must already be App-connected and active.
 */
export async function createBountyFromIssueUrl(
  input: CreateBountyInput,
  opts: {
    db: Database;
    http?: GitHubHttp;
    jwt?: string;
    fetchIssueSnapshot?: (
      owner: string,
      repo: string,
      issueNumber: number,
      installationId: bigint,
    ) => Promise<GitHubIssueSnapshot | null>;
  },
): Promise<CreatedBounty> {
  if (!input.posterUserId) {
    throw new BountyError("unauthorized", "Sign in with Google to post a bounty.");
  }

  const parsed = parseGitHubIssueUrl(input.issueUrl);
  if (!parsed) {
    throw new BountyError(
      "invalid_issue_url",
      "Enter a GitHub issue URL like https://github.com/owner/repo/issues/123.",
    );
  }

  const amountUsdc = normalizeBountyAmountUsdc(input.amountUsdc);
  const repo = await findActiveRepoByFullName(parsed.fullName, opts.db);
  if (!repo) {
    throw new BountyError(
      "repo_not_connected",
      `${parsed.fullName} is not an App-connected repo. Connect GitHub from Settings first.`,
    );
  }

  let snapshot: GitHubIssueSnapshot | null = null;
  if (input.title?.trim()) {
    snapshot = {
      title: input.title.trim(),
      body: input.description?.trim() || null,
      htmlUrl: parsed.url,
      state: "open",
    };
  } else {
    try {
      const fetchFn =
        opts.fetchIssueSnapshot ??
        ((owner, name, number, installationId) =>
          fetchIssue(owner, name, number, {
            installationId,
            http: opts.http,
            jwt: opts.jwt,
          }));
      snapshot = await fetchFn(parsed.owner, parsed.repo, parsed.issueNumber, repo.installationId);
    } catch {
      snapshot = null;
    }
  }

  const title = snapshot?.title?.trim() || `${parsed.fullName}#${parsed.issueNumber}`;
  const descriptionSnapshot = clip(
    input.description?.trim() || snapshot?.body || null,
    DESCRIPTION_MAX,
  );

  try {
    const created = await opts.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(bounties)
        .values({
          repoId: repo.id,
          githubIssueNumber: parsed.issueNumber,
          url: parsed.url,
          posterUserId: input.posterUserId,
          amountUsdc,
          currency: DEFAULT_CURRENCY,
          chain: DEFAULT_CHAIN,
          status: "pending_fund",
          title,
          descriptionSnapshot,
        })
        .returning({
          id: bounties.id,
          repoId: bounties.repoId,
          githubIssueNumber: bounties.githubIssueNumber,
          url: bounties.url,
          status: bounties.status,
          title: bounties.title,
          amountUsdc: bounties.amountUsdc,
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
    };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new BountyError(
        "bounty_exists",
        `An active bounty already exists for ${parsed.fullName}#${parsed.issueNumber}.`,
      );
    }
    throw err;
  }
}

function clip(value: string | null, max: number): string | null {
  if (!value) return null;
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
