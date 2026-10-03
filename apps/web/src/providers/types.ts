import type { Database } from "../db/client";
import type { BountyProvider } from "../db/schema";
import type { GitHubHttp } from "../github/api";
import type { PublicClosingPull } from "../github/public-read";
import type { GitHubWebhookPayload } from "../webhooks/types";

export class ProviderNotSupportedError extends Error {
  readonly code = "provider_not_supported" as const;

  constructor(provider: string) {
    super(`Provider ${provider} is not supported.`);
    this.name = "ProviderNotSupportedError";
  }
}

export type IssueRef = {
  provider: BountyProvider;
  owner: string;
  repo: string;
  fullName: string;
  issueNumber: number;
  url: string;
};

export type PrRef = {
  provider: BountyProvider;
  owner: string;
  repo: string;
  fullName: string;
  prNumber: number;
  url: string;
};

export type ProviderAuthor = {
  id: string | null;
  login: string | null;
};

/** Repo facts used for the Gemini card and for anti-spam checks. */
export type RepoMeta = {
  fullName: string;
  private: boolean | null;
  createdAt: string | null;
  description: string | null;
  language: string | null;
  languages: string[];
  readmeBlurb: string | null;
  stars: number | null;
  ownerId: string | null;
  ownerLogin: string | null;
  githubRepoId: bigint | null;
  defaultBranch: string | null;
};

export type FetchedIssue = {
  title: string;
  body: string | null;
  state: string;
  author: ProviderAuthor;
  htmlUrl: string;
  pullRequest: boolean;
  repo: RepoMeta;
};

export type MergeVerification = {
  merged: boolean;
  author: ProviderAuthor;
  merger: ProviderAuthor | null;
  mergeCommitSha: string | null;
  mergedAt: string | null;
};

export type ProviderIdentity = {
  provider: BountyProvider;
  providerUserId: string | null;
  login: string | null;
};

export type LinkedProviderUser = {
  userId: string;
  providerUserId: string;
  login: string;
};

export type ProviderCallOpts = {
  http?: GitHubHttp;
  jwt?: string;
  env?: NodeJS.ProcessEnv;
  installationId?: bigint | null;
};

export interface RepoProvider {
  id: BountyProvider;
  parseIssueUrl(url: string): IssueRef | null;
  fetchIssue(ref: IssueRef, opts?: ProviderCallOpts): Promise<FetchedIssue>;
  parsePrUrl(url: string): PrRef | null;
  verifyMerge(pr: PrRef, opts?: ProviderCallOpts): Promise<MergeVerification>;
  repoMeta(ref: { owner: string; repo: string }, opts?: ProviderCallOpts): Promise<RepoMeta>;
  identitiesMatch(left: ProviderIdentity, right: ProviderIdentity): boolean;
  findLinkedUser(db: Database, identity: ProviderIdentity): Promise<LinkedProviderUser | null>;
  identityForUser(db: Database, userId: string): Promise<ProviderIdentity | null>;
  /** Merged pull requests that might close an issue. Same objects the poller already consumes. */
  listClosingPulls(args: {
    owner: string;
    repo: string;
    issueNumber: number;
    http?: GitHubHttp;
    env?: NodeJS.ProcessEnv;
  }): Promise<PublicClosingPull[]>;
  /** Webhook payload the merge poller already feeds to eligibility. */
  mergeDeliveryPayload(fullName: string, pull: PublicClosingPull): GitHubWebhookPayload;
}
