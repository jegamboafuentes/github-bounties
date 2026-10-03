import type { PublicClosingPull } from "../github/public-read";
import type { GitHubWebhookPayload } from "../webhooks/types";

/** Same payload the public-merge poller already hands to eligibility. */
export function closingPullToWebhookPayload(
  fullName: string,
  pull: PublicClosingPull,
): GitHubWebhookPayload {
  return {
    action: "closed",
    repository: {
      full_name: fullName,
      default_branch: pull.defaultBranch,
    },
    pull_request: {
      number: pull.number,
      title: pull.title,
      body: pull.body,
      merged: pull.merged,
      merged_at: pull.mergedAt ?? null,
      html_url: pull.htmlUrl ?? `https://github.com/${fullName}/pull/${pull.number}`,
      user: {
        login: pull.authorLogin,
        id: pull.authorId ?? null,
      },
      base: {
        ref: pull.baseRef,
        repo: {
          full_name: fullName,
          default_branch: pull.defaultBranch,
        },
      },
      merge_commit_sha: pull.mergeCommitSha ?? null,
      merge_commit_message: pull.mergeCommitMessage ?? null,
      commit_messages: pull.commitMessages ?? null,
      closing_issue_numbers: pull.closingIssueNumbers ?? null,
    },
  };
}
