import type { Database } from "../db/client";
import {
  fetchIssue as fetchInstalledIssue,
  fetchRepoContext,
  type GitHubIssueSnapshot,
} from "../github/api";
import { findGithubLinkByIdOrLogin, findGithubLinkByUserId } from "../github/persist";
import { fetchPublicPull, listPublicClosingPulls, resolvePublicIssue } from "../github/public-read";
import { closingPullToWebhookPayload } from "../bounties/merge-payload";
import { parseGitHubIssueUrl } from "../bounties/parse-issue-url";
import type {
  FetchedIssue,
  IssueRef,
  LinkedProviderUser,
  MergeVerification,
  PrRef,
  ProviderCallOpts,
  ProviderIdentity,
  RepoMeta,
  RepoProvider,
} from "./types";

const PULL_PATH =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)\/pull\/(\d+)(?:[/?#].*)?$/i;

function isGitHubName(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value) && value !== "." && value !== "..";
}

function emptyRepo(fullName: string): RepoMeta {
  return {
    fullName,
    private: null,
    createdAt: null,
    description: null,
    language: null,
    languages: [],
    readmeBlurb: null,
    stars: null,
    ownerId: null,
    ownerLogin: null,
    githubRepoId: null,
    defaultBranch: null,
  };
}

function authorOf(login: string | null | undefined, id: string | null | undefined) {
  return { login: login?.trim() || null, id: id?.trim() || null };
}

/** Same snapshot shape callers already pass to the postable-issue check. */
export function toGitHubIssueSnapshot(issue: FetchedIssue): GitHubIssueSnapshot {
  return {
    title: issue.title,
    body: issue.body,
    htmlUrl: issue.htmlUrl,
    state: issue.state,
    pullRequest: issue.pullRequest,
    authorLogin: issue.author.login,
    authorId: issue.author.id,
  };
}

export const githubProvider: RepoProvider = {
  id: "github",

  parseIssueUrl(url: string): IssueRef | null {
    const parsed = parseGitHubIssueUrl(url);
    if (!parsed) return null;
    return { provider: "github", ...parsed };
  },

  async fetchIssue(ref: IssueRef, opts: ProviderCallOpts = {}): Promise<FetchedIssue> {
    if (opts.installationId != null) {
      const snapshot = await fetchInstalledIssue(ref.owner, ref.repo, ref.issueNumber, {
        installationId: opts.installationId,
        http: opts.http,
        jwt: opts.jwt,
      });
      return {
        title: snapshot.title,
        body: snapshot.body,
        state: snapshot.state,
        author: authorOf(snapshot.authorLogin, snapshot.authorId),
        htmlUrl: snapshot.htmlUrl,
        pullRequest: false,
        repo: emptyRepo(ref.fullName),
      };
    }

    const resolved = await resolvePublicIssue(ref.owner, ref.repo, ref.issueNumber, {
      http: opts.http,
      env: opts.env,
    });
    return {
      title: resolved.issue.title,
      body: resolved.issue.body,
      state: resolved.issue.state,
      author: authorOf(resolved.issue.authorLogin, resolved.issue.authorId),
      htmlUrl: resolved.issue.htmlUrl,
      pullRequest: Boolean(resolved.issue.pullRequest),
      repo: {
        ...emptyRepo(resolved.fullName),
        fullName: resolved.fullName,
        private: resolved.private,
        createdAt: resolved.createdAt,
        description: resolved.description,
        stars: resolved.stars,
        ownerId: resolved.ownerId,
        ownerLogin: resolved.ownerLogin,
        githubRepoId: resolved.githubRepoId,
        defaultBranch: resolved.defaultBranch,
      },
    };
  },

  parsePrUrl(url: string): PrRef | null {
    const match = url.trim().match(PULL_PATH);
    if (!match) return null;
    const owner = match[1] ?? "";
    const repo = match[2] ?? "";
    const prNumber = Number.parseInt(match[3] ?? "", 10);
    if (!isGitHubName(owner) || !isGitHubName(repo)) return null;
    if (!Number.isInteger(prNumber) || prNumber <= 0) return null;
    const fullName = `${owner}/${repo}`;
    return {
      provider: "github",
      owner,
      repo,
      fullName,
      prNumber,
      url: `https://github.com/${fullName}/pull/${prNumber}`,
    };
  },

  async verifyMerge(pr: PrRef, opts: ProviderCallOpts = {}): Promise<MergeVerification> {
    const pull = await fetchPublicPull({
      owner: pr.owner,
      repo: pr.repo,
      prNumber: pr.prNumber,
      http: opts.http,
      env: opts.env,
    });
    if (!pull) {
      return {
        merged: false,
        author: { id: null, login: null },
        merger: null,
        mergeCommitSha: null,
        mergedAt: null,
      };
    }
    const mergerLogin = pull.mergedByLogin?.trim() || null;
    const mergerId = pull.mergedById != null ? String(pull.mergedById) : null;
    return {
      merged: pull.merged,
      author: {
        id: pull.authorId != null ? String(pull.authorId) : null,
        login: pull.authorLogin?.trim() || null,
      },
      merger: mergerLogin || mergerId ? { id: mergerId, login: mergerLogin } : null,
      mergeCommitSha: pull.mergeCommitSha ?? null,
      mergedAt: pull.mergedAt ?? null,
    };
  },

  async repoMeta(ref: { owner: string; repo: string }, opts: ProviderCallOpts = {}): Promise<RepoMeta> {
    const context = await fetchRepoContext(ref.owner, ref.repo, {
      installationId: opts.installationId,
      http: opts.http,
      jwt: opts.jwt,
      env: opts.env,
    });
    return {
      ...emptyRepo(`${ref.owner}/${ref.repo}`),
      private: context.private,
      createdAt: context.createdAt,
      description: context.description,
      language: context.language,
      languages: context.languages,
      readmeBlurb: context.readmeBlurb,
      stars: context.stars,
      ownerId: context.ownerId,
      ownerLogin: context.ownerLogin,
    };
  },

  identitiesMatch(left: ProviderIdentity, right: ProviderIdentity): boolean {
    const a = left.login?.trim().toLowerCase() ?? "";
    const b = right.login?.trim().toLowerCase() ?? "";
    return a.length > 0 && a === b;
  },

  async findLinkedUser(db: Database, identity: ProviderIdentity): Promise<LinkedProviderUser | null> {
    const rawId = identity.providerUserId?.trim() ?? "";
    const githubId = /^\d+$/.test(rawId) ? BigInt(rawId) : null;
    const link = await findGithubLinkByIdOrLogin(db, {
      githubId,
      githubLogin: identity.login,
    });
    if (!link) return null;
    return {
      userId: link.userId,
      providerUserId: link.githubId.toString(),
      login: link.githubLogin,
    };
  },

  async identityForUser(db: Database, userId: string): Promise<ProviderIdentity | null> {
    const link = await findGithubLinkByUserId(userId, db);
    if (!link) return null;
    return {
      provider: "github",
      providerUserId: link.githubId.toString(),
      login: link.githubLogin,
    };
  },

  listClosingPulls(args) {
    return listPublicClosingPulls(args);
  },

  mergeDeliveryPayload(fullName, pull) {
    return closingPullToWebhookPayload(fullName, pull);
  },
};
