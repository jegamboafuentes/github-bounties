export type PullRequestSurface = {
  number: number;
  title: string;
  body: string;
  merged: boolean;
  authorLogin: string;
  baseRef: string;
  /**
   * Squash/merge commit message when known.
   * GitHub does not put this on the pull_request webhook; V1 should fetch the
   * merge commit. Fixtures inject it for squash-merge cases.
   */
  mergeCommitMessage?: string;
  /**
   * GraphQL `closingIssuesReferences` / Development-sidebar links.
   * Not present on the REST webhook payload; V1 should fetch after merge.
   */
  closingIssueNumbers?: number[];
  /** Commit messages on the PR (merge-commit / rebase paths). */
  commitMessages?: string[];
};

export type EligibilityInput = {
  event: string;
  action?: string;
  repositoryFullName: string;
  defaultBranch: string;
  pullRequest?: PullRequestSurface;
};

export type EligibilityDecision = {
  eligible: boolean;
  reason: string;
  closedIssueNumbers: number[];
  winnerLogin?: string;
  pullRequestNumber?: number;
  repositoryFullName: string;
};

export type HandleResult = {
  duplicate: boolean;
  deliveryId: string;
  event: string;
  decision?: EligibilityDecision;
  logs: string[];
};

export type GitHubWebhookPayload = {
  action?: string;
  zen?: string;
  pull_request?: {
    number?: number;
    title?: string | null;
    body?: string | null;
    merged?: boolean | null;
    user?: { login?: string | null } | null;
    base?: {
      ref?: string | null;
      repo?: {
        default_branch?: string | null;
        full_name?: string | null;
      } | null;
    } | null;
    merge_commit_sha?: string | null;
  };
  repository?: {
    full_name?: string | null;
    default_branch?: string | null;
  } | null;
  installation?: { id?: number } | null;
};
