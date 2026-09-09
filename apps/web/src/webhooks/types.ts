/**
 * Promoted from repo-root V0-B `src/types.ts`.
 * Product path adds merge metadata used when writing `claims`.
 */

export type PullRequestSurface = {
  number: number;
  title: string;
  body: string;
  merged: boolean;
  authorLogin: string;
  authorId?: number;
  baseRef: string;
  htmlUrl?: string;
  mergedAt?: string | null;
  mergeCommitSha?: string | null;
  /**
   * Squash/merge commit message when known.
   * GitHub does not put this on the pull_request webhook; fetch the merge
   * commit when App credentials exist. Fixtures inject it for squash cases.
   */
  mergeCommitMessage?: string;
  /**
   * GraphQL `closingIssuesReferences` / Development-sidebar links.
   * Not present on the REST webhook payload; fetch after merge when possible.
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
  winnerId?: number;
  pullRequestNumber?: number;
  repositoryFullName: string;
};

export type HandleResult = {
  duplicate: boolean;
  deliveryId: string;
  event: string;
  decision?: EligibilityDecision;
  logs: string[];
  claims?: ClaimWriteResult[];
};

export type ClaimWriteResult = {
  issueNumber: number;
  bountyId?: string;
  claimId?: string;
  status?: string;
  skip?: string;
};

export type GitHubWebhookPayload = {
  action?: string;
  zen?: string;
  pull_request?: {
    number?: number;
    title?: string | null;
    body?: string | null;
    merged?: boolean | null;
    merged_at?: string | null;
    html_url?: string | null;
    user?: { login?: string | null; id?: number | null } | null;
    base?: {
      ref?: string | null;
      repo?: {
        id?: number | null;
        default_branch?: string | null;
        full_name?: string | null;
      } | null;
    } | null;
    merge_commit_sha?: string | null;
    /** Fixture-only surfaces (not on live REST webhooks). */
    merge_commit_message?: string | null;
    commit_messages?: string[] | null;
    closing_issue_numbers?: number[] | null;
  };
  repository?: {
    id?: number | null;
    full_name?: string | null;
    default_branch?: string | null;
  } | null;
  installation?: { id?: number | null } | null;
  sender?: { login?: string | null; id?: number | null } | null;
};
