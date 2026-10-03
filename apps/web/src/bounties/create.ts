import type { Database } from "../db/client";
import { bounties, escrows, type BountyProvider, type repos } from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import { type GitHubHttp, type GitHubIssueSnapshot } from "../github/api";
import { findActiveRepoByFullName, upsertPublicReferenceRepo } from "../github/persist";
import { isPublicGitHubError, PublicGitHubError } from "../github/public-read";
import { hfBountiesEnabled } from "../providers/huggingface";
import { getProvider } from "../providers/registry";
import { toGitHubIssueSnapshot } from "../providers/github";
import { createHuggingFaceBounty } from "./hf-create";
import { readPlatformSettings } from "../admin/settings";
import { DEFAULT_CHAIN, DEFAULT_CURRENCY } from "../lib/constants";
import { normalizeBountyAmountUsdc } from "./amount";
import { BountyError } from "./errors";
import { clipIssueBody } from "./markdown";

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
  provider: BountyProvider;
};

type RepoRow = typeof repos.$inferSelect;

/**
 * Persist a bounty as `pending_fund` (the form is the draft; schema has no draft status).
 *
 * Public issue URLs do not need an App installation. Active `app_install` repos
 * still resolve through the installation token. Closed issues and pull requests
 * are rejected. `fetchIssueSnapshot` returning null skips the live read (tests).
 */
export async function createBountyFromIssueUrl(
  input: CreateBountyInput,
  opts: {
    db: Database;
    http?: GitHubHttp;
    jwt?: string;
    env?: NodeJS.ProcessEnv;
    fetchIssueSnapshot?: (
      owner: string,
      repo: string,
      issueNumber: number,
      installationId: bigint | null,
    ) => Promise<GitHubIssueSnapshot | null>;
  },
): Promise<CreatedBounty> {
  if (!input.posterUserId) {
    throw new BountyError("unauthorized", "Sign in with Google to post a bounty.");
  }

  const env = opts.env ?? process.env;
  const hfRef = getProvider("huggingface").parseIssueUrl(input.issueUrl);
  if (hfRef) {
    if (!hfBountiesEnabled(env)) {
      throw new BountyError(
        "hf_disabled",
        "Hugging Face bounties are disabled. Set HF_BOUNTIES_ENABLED=1 to post a discussion bounty.",
      );
    }
    return createHuggingFaceBounty(input, hfRef, { ...opts, env });
  }

  const parsed = getProvider("github").parseIssueUrl(input.issueUrl);
  if (!parsed) {
    throw new BountyError(
      "invalid_issue_url",
      "Enter a GitHub issue URL like https://github.com/owner/repo/issues/123.",
    );
  }

  const amountUsdc = normalizeBountyAmountUsdc(input.amountUsdc);
  const existing = await findActiveRepoByFullName(parsed.fullName, opts.db);
  const resolved = await resolveRepoAndIssue(parsed, existing, input.posterUserId, opts);
  if (resolved.snapshot) {
    assertPostableIssue(parsed.fullName, parsed.issueNumber, resolved.snapshot);
  }

  const snapshot = resolved.snapshot;
  const fetchedFromGitHub = !input.title?.trim() && Boolean(snapshot);
  const title =
    input.title?.trim() ||
    snapshot?.title?.trim() ||
    `${parsed.fullName}#${parsed.issueNumber}`;
  const descriptionSnapshot = clipIssueBody(
    input.description?.trim() || snapshot?.body || null,
  );

  try {
    const created = await opts.db.transaction(async (tx) => {
      const database = tx as unknown as Database;
      const rates = await readPlatformSettings(database);
      const [row] = await tx
        .insert(bounties)
        .values({
          repoId: resolved.repo.id,
          githubIssueNumber: parsed.issueNumber,
          url: parsed.url,
          posterUserId: input.posterUserId,
          amountUsdc,
          currency: DEFAULT_CURRENCY,
          chain: DEFAULT_CHAIN,
          status: "pending_fund",
          title,
          descriptionSnapshot,
          issueBodySyncedAt: fetchedFromGitHub ? new Date() : null,
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
      provider: created.provider === "huggingface" ? "huggingface" : "github",
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

export function bountyErrorForPublicRead(
  err: PublicGitHubError,
  fullName: string,
  issueNumber: number,
): BountyError {
  const ref = `${fullName}#${issueNumber}`;
  switch (err.code) {
    case "not_found":
      return new BountyError(
        "issue_not_found",
        `${ref} was not found. Check the URL. Private repositories stay hidden unless the GitHub App is installed on them.`,
      );
    case "inaccessible":
      return new BountyError(
        "issue_inaccessible",
        `${ref} is private or inaccessible. Only public issues can be posted without the GitHub App.`,
      );
    case "rate_limited":
      return new BountyError(
        "issue_rate_limited",
        "GitHub rate limit reached while reading this public issue. Set GITHUB_PUBLIC_READ_TOKEN or retry in a few minutes.",
      );
    case "not_an_issue":
      return new BountyError(
        "not_an_issue",
        `${ref} is a pull request, not an issue. Paste an issue URL.`,
      );
    default:
      return new BountyError(
        "github_unavailable",
        `GitHub could not be reached for ${ref}${err.status ? ` (HTTP ${err.status})` : ""}.`,
      );
  }
}

function assertPostableIssue(
  fullName: string,
  issueNumber: number,
  snapshot: GitHubIssueSnapshot,
): void {
  if (snapshot.pullRequest) {
    throw bountyErrorForPublicRead(
      new PublicGitHubError("not_an_issue", 200, "pull request"),
      fullName,
      issueNumber,
    );
  }
  if (snapshot.state.toLowerCase() === "closed") {
    throw new BountyError(
      "issue_closed",
      `${fullName}#${issueNumber} is already closed. Post a bounty on an open issue.`,
    );
  }
}

async function resolveRepoAndIssue(
  parsed: { owner: string; repo: string; fullName: string; issueNumber: number },
  existing: RepoRow | null,
  posterUserId: string,
  opts: {
    db: Database;
    http?: GitHubHttp;
    jwt?: string;
    env?: NodeJS.ProcessEnv;
    fetchIssueSnapshot?: (
      owner: string,
      repo: string,
      issueNumber: number,
      installationId: bigint | null,
    ) => Promise<GitHubIssueSnapshot | null>;
  },
): Promise<{ repo: RepoRow; snapshot: GitHubIssueSnapshot | null }> {
  if (opts.fetchIssueSnapshot) {
    if (!existing) {
      throw new BountyError(
        "issue_not_found",
        `${parsed.fullName}#${parsed.issueNumber} was not found.`,
      );
    }
    const snapshot = await opts.fetchIssueSnapshot(
      parsed.owner,
      parsed.repo,
      parsed.issueNumber,
      existing.installationId,
    );
    return { repo: existing, snapshot };
  }

  const provider = getProvider("github");
  const ref = {
    provider: "github" as const,
    owner: parsed.owner,
    repo: parsed.repo,
    fullName: parsed.fullName,
    issueNumber: parsed.issueNumber,
    url: `https://github.com/${parsed.fullName}/issues/${parsed.issueNumber}`,
  };
  const useInstall =
    existing?.connectionKind === "app_install" && existing.installationId != null;
  if (useInstall && existing) {
    try {
      const fetched = await provider.fetchIssue(ref, {
        installationId: existing.installationId as bigint,
        http: opts.http,
        jwt: opts.jwt,
      });
      return { repo: existing, snapshot: toGitHubIssueSnapshot(fetched) };
    } catch (err) {
      throw bountyErrorForInstalledFetch(err, parsed.fullName, parsed.issueNumber);
    }
  }

  try {
    const fetched = await provider.fetchIssue(ref, {
      http: opts.http,
      env: opts.env,
    });
    const snapshot = toGitHubIssueSnapshot(fetched);
    assertPostableIssue(parsed.fullName, parsed.issueNumber, snapshot);
    if (fetched.repo.githubRepoId == null) {
      throw new PublicGitHubError("unavailable", 200, "GitHub repo payload missing id");
    }
    const repo = await upsertPublicReferenceRepo({
      userId: posterUserId,
      githubRepoId: fetched.repo.githubRepoId,
      fullName: fetched.repo.fullName,
      db: opts.db,
    });
    return { repo, snapshot };
  } catch (err) {
    if (err instanceof BountyError) throw err;
    if (isPublicGitHubError(err)) {
      throw bountyErrorForPublicRead(err, parsed.fullName, parsed.issueNumber);
    }
    throw new BountyError(
      "github_unavailable",
      `GitHub could not be reached for ${parsed.fullName}#${parsed.issueNumber}.`,
    );
  }
}

function bountyErrorForInstalledFetch(
  err: unknown,
  fullName: string,
  issueNumber: number,
): BountyError {
  const message = err instanceof Error ? err.message : "";
  if (/pull request/i.test(message)) {
    return bountyErrorForPublicRead(
      new PublicGitHubError("not_an_issue", 200, message),
      fullName,
      issueNumber,
    );
  }
  const status = Number(message.match(/HTTP (\d+)/)?.[1] ?? 0);
  if (status === 404) {
    return bountyErrorForPublicRead(
      new PublicGitHubError("not_found", 404, message),
      fullName,
      issueNumber,
    );
  }
  if (status === 429 || /rate limit/i.test(message)) {
    return bountyErrorForPublicRead(
      new PublicGitHubError("rate_limited", status || 429, message),
      fullName,
      issueNumber,
    );
  }
  if (status === 401 || status === 403) {
    return bountyErrorForPublicRead(
      new PublicGitHubError("inaccessible", status, message),
      fullName,
      issueNumber,
    );
  }
  return bountyErrorForPublicRead(
    new PublicGitHubError("unavailable", status, message || "GitHub issue fetch failed"),
    fullName,
    issueNumber,
  );
}
