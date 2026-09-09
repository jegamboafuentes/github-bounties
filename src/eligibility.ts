import { closingIssueNumbersForRepo } from "./closing-keywords.js";
import type { EligibilityDecision, EligibilityInput } from "./types.js";

/**
 * V1 winner rule: author of the merged PR that closes funded issue `#N`.
 *
 * Claim-lock coordinates work; **merge is truth**. This function does not
 * look at claim-lock state.
 */
export function evaluateEligibility(
  input: EligibilityInput,
): EligibilityDecision {
  const repositoryFullName = input.repositoryFullName;

  if (input.event !== "pull_request") {
    return deny(
      repositoryFullName,
      `event ${input.event} is not an eligibility signal (merge is truth)`,
    );
  }

  if (input.action !== "closed") {
    return deny(
      repositoryFullName,
      `pull_request action ${input.action ?? "(none)"} is not closed`,
    );
  }

  const pr = input.pullRequest;
  if (!pr) {
    return deny(repositoryFullName, "pull_request payload missing");
  }

  if (!pr.merged) {
    return deny(
      repositoryFullName,
      "pull request closed without merge",
      pr,
    );
  }

  if (!input.defaultBranch) {
    return deny(
      repositoryFullName,
      "repository default branch unknown",
      pr,
    );
  }

  if (pr.baseRef !== input.defaultBranch) {
    return deny(
      repositoryFullName,
      `merged into ${pr.baseRef}, not default branch ${input.defaultBranch} (GitHub ignores closing keywords off default)`,
      pr,
    );
  }

  const fromText = closingIssueNumbersForRepo(
    [
      pr.title,
      pr.body,
      pr.mergeCommitMessage,
      ...(pr.commitMessages ?? []),
    ],
    repositoryFullName,
  );

  const fromLinks = uniquePositive(pr.closingIssueNumbers ?? []);
  const closedIssueNumbers = uniquePositive([...fromText, ...fromLinks]);

  if (closedIssueNumbers.length === 0) {
    return deny(
      repositoryFullName,
      "merged to default branch but no closing keyword or linked issue for this repository",
      pr,
    );
  }

  return {
    eligible: true,
    reason: `merged PR #${pr.number} closes ${closedIssueNumbers
      .map((n) => `#${n}`)
      .join(", ")}`,
    closedIssueNumbers,
    winnerLogin: pr.authorLogin,
    pullRequestNumber: pr.number,
    repositoryFullName,
  };
}

function deny(
  repositoryFullName: string,
  reason: string,
  pr?: EligibilityInput["pullRequest"],
): EligibilityDecision {
  return {
    eligible: false,
    reason,
    closedIssueNumbers: [],
    winnerLogin: pr?.authorLogin,
    pullRequestNumber: pr?.number,
    repositoryFullName,
  };
}

function uniquePositive(numbers: number[]): number[] {
  return [...new Set(numbers.filter((n) => Number.isInteger(n) && n > 0))].sort(
    (a, b) => a - b,
  );
}
