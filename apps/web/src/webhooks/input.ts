import type {
  EligibilityInput,
  GitHubWebhookPayload,
  PullRequestSurface,
} from "./types";

/** Map a verified GitHub webhook payload to the V0-B eligibility input. */
export function toEligibilityInput(
  event: string,
  payload: GitHubWebhookPayload,
): EligibilityInput {
  const repositoryFullName =
    payload.repository?.full_name ??
    payload.pull_request?.base?.repo?.full_name ??
    "";
  const defaultBranch =
    payload.repository?.default_branch ??
    payload.pull_request?.base?.repo?.default_branch ??
    "";

  let pullRequest: PullRequestSurface | undefined;
  const rawPr = payload.pull_request;
  const prNumber = rawPr?.number;
  if (rawPr && prNumber != null) {
    const authorId = rawPr.user?.id;
    pullRequest = {
      number: prNumber,
      title: rawPr.title ?? "",
      body: rawPr.body ?? "",
      merged: Boolean(rawPr.merged),
      authorLogin: rawPr.user?.login ?? "",
      authorId: typeof authorId === "number" ? authorId : undefined,
      baseRef: rawPr.base?.ref ?? "",
      htmlUrl: rawPr.html_url ?? undefined,
      mergedAt: rawPr.merged_at ?? undefined,
      mergeCommitSha: rawPr.merge_commit_sha ?? undefined,
      mergeCommitMessage: rawPr.merge_commit_message ?? undefined,
      commitMessages: rawPr.commit_messages ?? undefined,
      closingIssueNumbers: rawPr.closing_issue_numbers ?? undefined,
    };
  }

  return {
    event,
    action: payload.action,
    repositoryFullName,
    defaultBranch,
    pullRequest,
  };
}

export function applySurfaceOverrides(
  input: EligibilityInput,
  extras: {
    mergeCommitMessage?: string;
    commitMessages?: string[];
    closingIssueNumbers?: number[];
  },
): EligibilityInput {
  if (!input.pullRequest) return input;
  return {
    ...input,
    pullRequest: {
      ...input.pullRequest,
      mergeCommitMessage:
        extras.mergeCommitMessage ?? input.pullRequest.mergeCommitMessage,
      commitMessages: extras.commitMessages ?? input.pullRequest.commitMessages,
      closingIssueNumbers:
        extras.closingIssueNumbers ?? input.pullRequest.closingIssueNumbers,
    },
  };
}
