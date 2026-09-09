export type ParsedIssueUrl = {
  owner: string;
  repo: string;
  fullName: string;
  issueNumber: number;
  url: string;
};

const ISSUE_PATH =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)\/issues\/(\d+)(?:[/?#].*)?$/i;

/**
 * Accept a GitHub issue URL. Pull request URLs are rejected — V1 posts on issues.
 */
export function parseGitHubIssueUrl(raw: string): ParsedIssueUrl | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(ISSUE_PATH);
  if (!match) return null;

  const owner = match[1] ?? "";
  const repo = match[2] ?? "";
  const issueNumber = Number.parseInt(match[3] ?? "", 10);
  if (!isGitHubName(owner) || !isGitHubName(repo)) return null;
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) return null;

  const fullName = `${owner}/${repo}`;
  return {
    owner,
    repo,
    fullName,
    issueNumber,
    url: `https://github.com/${fullName}/issues/${issueNumber}`,
  };
}

function isGitHubName(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value) && value !== "." && value !== "..";
}
