import {
  GITHUB_API,
  publicGitHubHeaders,
  readGitHubPublicReadToken,
  type GitHubHttp,
  type GitHubIssueSnapshot,
} from "./api";

export type PublicReadFailureCode =
  | "not_found"
  | "inaccessible"
  | "rate_limited"
  | "not_an_issue"
  | "unavailable";

export class PublicGitHubError extends Error {
  readonly code: PublicReadFailureCode;
  readonly status: number;

  constructor(code: PublicReadFailureCode, status: number, message: string) {
    super(message);
    this.name = "PublicGitHubError";
    this.code = code;
    this.status = status;
  }
}

export function isPublicGitHubError(err: unknown): err is PublicGitHubError {
  return err instanceof PublicGitHubError;
}

export type ResolvedPublicIssue = {
  githubRepoId: bigint;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  issue: GitHubIssueSnapshot;
};

export type PublicClosingPull = {
  number: number;
  title: string;
  body: string;
  merged: boolean;
  authorLogin: string;
  authorId?: number;
  baseRef: string;
  defaultBranch: string;
  htmlUrl?: string;
  mergedAt?: string | null;
  mergeCommitSha?: string | null;
  mergeCommitMessage?: string;
  commitMessages?: string[];
  closingIssueNumbers?: number[];
};

type JsonResponse = { ok: boolean; status: number; body: unknown };

function defaultHttp(
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) {
  return fetch(input, init);
}

function githubMessage(body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "message" in body &&
    typeof (body as { message?: unknown }).message === "string"
  ) {
    return (body as { message: string }).message;
  }
  return "";
}

export function classifyPublicGitHubStatus(
  status: number,
  body: unknown,
): PublicGitHubError | null {
  if (status >= 200 && status < 300) return null;
  const message = githubMessage(body);
  if (status === 429 || /rate limit/i.test(message)) {
    return new PublicGitHubError(
      "rate_limited",
      status,
      message || "GitHub rate limit exceeded",
    );
  }
  if (status === 404) {
    return new PublicGitHubError("not_found", status, message || "Not Found");
  }
  if (status === 401 || status === 403) {
    return new PublicGitHubError(
      "inaccessible",
      status,
      message || "GitHub resource is private or inaccessible",
    );
  }
  return new PublicGitHubError(
    "unavailable",
    status,
    message || `GitHub request failed (HTTP ${status})`,
  );
}

async function readJson(
  http: GitHubHttp,
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<JsonResponse> {
  const res = await http(url, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

function throwIfFailed(res: JsonResponse): void {
  const err = classifyPublicGitHubStatus(res.status, res.body);
  if (err) throw err;
}

/**
 * Read a public issue plus its repo id. No App installation token.
 * `GITHUB_PUBLIC_READ_TOKEN` is optional and only raises the rate limit.
 * Closed issues are returned; the caller decides whether to reject them.
 * Pull requests (same number space) throw `not_an_issue`.
 */
export async function resolvePublicIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  opts: { http?: GitHubHttp; env?: NodeJS.ProcessEnv } = {},
): Promise<ResolvedPublicIssue> {
  const http = opts.http ?? defaultHttp;
  const headers = publicGitHubHeaders(readGitHubPublicReadToken(opts.env));
  const repoRes = await readJson(http, `${GITHUB_API}/repos/${owner}/${repo}`, { headers });
  throwIfFailed(repoRes);
  const repoBody = repoRes.body as {
    id?: number;
    full_name?: string;
    private?: boolean;
    default_branch?: string;
  };
  if (repoBody.private) {
    throw new PublicGitHubError(
      "inaccessible",
      200,
      `${repoBody.full_name ?? `${owner}/${repo}`} is private`,
    );
  }
  if (repoBody.id == null || !repoBody.full_name) {
    throw new PublicGitHubError("unavailable", repoRes.status, "GitHub repo payload missing id");
  }

  const issueRes = await readJson(
    http,
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}`,
    { headers },
  );
  throwIfFailed(issueRes);
  const issueBody = issueRes.body as {
    title?: string;
    body?: string | null;
    html_url?: string;
    state?: string;
    pull_request?: unknown;
  };
  if (issueBody.pull_request) {
    throw new PublicGitHubError(
      "not_an_issue",
      200,
      `${owner}/${repo}#${issueNumber} is a pull request, not an issue`,
    );
  }
  if (!issueBody.title) {
    throw new PublicGitHubError("unavailable", issueRes.status, "GitHub issue missing title");
  }

  return {
    githubRepoId: BigInt(repoBody.id),
    fullName: repoBody.full_name,
    defaultBranch: repoBody.default_branch ?? "main",
    private: false,
    issue: {
      title: issueBody.title,
      body: issueBody.body ?? null,
      htmlUrl:
        issueBody.html_url ?? `https://github.com/${repoBody.full_name}/issues/${issueNumber}`,
      state: issueBody.state ?? "open",
      pullRequest: false,
    },
  };
}

const MAX_PULLS = 20;

/**
 * Merged pull requests that might close `issueNumber`, via public REST and
 * (when `GITHUB_PUBLIC_READ_TOKEN` is set) GraphQL `closedByPullRequestsReferences`.
 * Callers still run `evaluateEligibility` — this list is candidates, not winners.
 */
export async function listPublicClosingPulls(args: {
  owner: string;
  repo: string;
  issueNumber: number;
  http?: GitHubHttp;
  env?: NodeJS.ProcessEnv;
}): Promise<PublicClosingPull[]> {
  const http = args.http ?? defaultHttp;
  const env = args.env ?? process.env;
  const token = readGitHubPublicReadToken(env);
  const headers = publicGitHubHeaders(token);
  const fullName = `${args.owner}/${args.repo}`;

  const repoRes = await readJson(http, `${GITHUB_API}/repos/${args.owner}/${args.repo}`, {
    headers,
  });
  throwIfFailed(repoRes);
  const repoBody = repoRes.body as { default_branch?: string; private?: boolean; full_name?: string };
  if (repoBody.private) {
    throw new PublicGitHubError(
      "inaccessible",
      200,
      `${repoBody.full_name ?? fullName} is private`,
    );
  }
  const defaultBranch = repoBody.default_branch ?? "main";

  const byNumber = new Map<number, PublicClosingPull>();

  if (token) {
    const fromGraph = await closingPullsFromGraphql({
      http,
      headers,
      owner: args.owner,
      repo: args.repo,
      issueNumber: args.issueNumber,
      defaultBranch,
    });
    for (const pull of fromGraph) byNumber.set(pull.number, pull);
  }

  let sawRateLimit = false;
  const numbers = new Set<number>(byNumber.keys());
  try {
    for (const n of await timelinePullNumbers(http, headers, args.owner, args.repo, args.issueNumber)) {
      numbers.add(n);
    }
  } catch (err) {
    if (isPublicGitHubError(err) && err.code === "rate_limited") sawRateLimit = true;
    else throw err;
  }
  try {
    for (const n of await searchMergedPullNumbers(
      http,
      headers,
      args.owner,
      args.repo,
      args.issueNumber,
    )) {
      numbers.add(n);
    }
  } catch (err) {
    if (isPublicGitHubError(err) && err.code === "rate_limited") sawRateLimit = true;
    else throw err;
  }

  if (numbers.size === 0 && sawRateLimit) {
    throw new PublicGitHubError(
      "rate_limited",
      403,
      "GitHub rate limit reached while listing pull requests",
    );
  }

  const missing = [...numbers].filter((n) => !byNumber.has(n)).slice(0, MAX_PULLS);
  for (const number of missing) {
    const pull = await readPull(http, headers, args.owner, args.repo, number, defaultBranch);
    if (pull) byNumber.set(number, pull);
  }

  return [...byNumber.values()]
    .filter((pull) => pull.merged)
    .sort((a, b) => a.number - b.number)
    .slice(0, MAX_PULLS);
}

async function timelinePullNumbers(
  http: GitHubHttp,
  headers: Record<string, string>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<number[]> {
  const wanted = `${owner}/${repo}`.toLowerCase();
  const numbers: number[] = [];
  const res = await readJson(
    http,
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/timeline?per_page=100`,
    { headers },
  );
  if (!res.ok) {
    const err = classifyPublicGitHubStatus(res.status, res.body);
    if (err?.code === "rate_limited") throw err;
    return numbers;
  }
  const events = Array.isArray(res.body) ? res.body : [];
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const row = event as {
      event?: string;
      source?: {
        issue?: {
          number?: number;
          pull_request?: unknown;
          repository?: { full_name?: string | null };
        };
      };
    };
    if (row.event !== "cross-referenced" && row.event !== "connected") continue;
    const issue = row.source?.issue;
    if (!issue?.pull_request || typeof issue.number !== "number") continue;
    const sourceRepo = issue.repository?.full_name?.toLowerCase();
    if (sourceRepo && sourceRepo !== wanted) continue;
    numbers.push(issue.number);
  }
  return numbers;
}

async function searchMergedPullNumbers(
  http: GitHubHttp,
  headers: Record<string, string>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<number[]> {
  const q = encodeURIComponent(`repo:${owner}/${repo} is:pr is:merged #${issueNumber}`);
  const res = await readJson(http, `${GITHUB_API}/search/issues?q=${q}&per_page=20`, { headers });
  if (!res.ok) {
    const err = classifyPublicGitHubStatus(res.status, res.body);
    if (err?.code === "rate_limited") throw err;
    return [];
  }
  const items =
    (res.body as { items?: Array<{ number?: number; pull_request?: unknown }> } | null)?.items ??
    [];
  return items
    .filter((item) => item.pull_request && typeof item.number === "number")
    .map((item) => item.number as number);
}

async function readPull(
  http: GitHubHttp,
  headers: Record<string, string>,
  owner: string,
  repo: string,
  number: number,
  defaultBranch: string,
): Promise<PublicClosingPull | null> {
  const res = await readJson(http, `${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}`, {
    headers,
  });
  if (!res.ok || !res.body || typeof res.body !== "object") return null;
  const body = res.body as {
    number?: number;
    title?: string | null;
    body?: string | null;
    merged?: boolean | null;
    merged_at?: string | null;
    html_url?: string | null;
    merge_commit_sha?: string | null;
    user?: { login?: string | null; id?: number | null } | null;
    base?: { ref?: string | null } | null;
  };
  if (body.number == null || !body.merged) return null;
  const authorLogin = body.user?.login?.trim() ?? "";
  let mergeCommitMessage: string | undefined;
  if (body.merge_commit_sha) {
    const commit = await readJson(
      http,
      `${GITHUB_API}/repos/${owner}/${repo}/commits/${body.merge_commit_sha}`,
      { headers },
    );
    if (commit.ok) {
      const message = (commit.body as { commit?: { message?: string } } | null)?.commit?.message;
      if (message) mergeCommitMessage = message;
    }
  }
  const commitsRes = await readJson(
    http,
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}/commits?per_page=30`,
    { headers },
  );
  const commitMessages = Array.isArray(commitsRes.body)
    ? commitsRes.body
        .map((row) => (row as { commit?: { message?: string } }).commit?.message)
        .filter((message): message is string => Boolean(message))
    : [];

  return {
    number: body.number,
    title: body.title ?? "",
    body: body.body ?? "",
    merged: true,
    authorLogin,
    authorId: typeof body.user?.id === "number" ? body.user.id : undefined,
    baseRef: body.base?.ref ?? "",
    defaultBranch,
    htmlUrl: body.html_url ?? undefined,
    mergedAt: body.merged_at ?? null,
    mergeCommitSha: body.merge_commit_sha ?? null,
    mergeCommitMessage,
    commitMessages: commitMessages.length ? commitMessages : undefined,
  };
}

async function closingPullsFromGraphql(args: {
  http: GitHubHttp;
  headers: Record<string, string>;
  owner: string;
  repo: string;
  issueNumber: number;
  defaultBranch: string;
}): Promise<PublicClosingPull[]> {
  const res = await readJson(args.http, `${GITHUB_API}/graphql`, {
    method: "POST",
    headers: { ...args.headers, "content-type": "application/json" },
    body: JSON.stringify({
      query: `query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          issue(number: $number) {
            closedByPullRequestsReferences(first: 20) {
              nodes {
                number
                title
                body
                merged
                mergedAt
                url
                baseRefName
                mergeCommit { oid message }
                author { login databaseId }
                closingIssuesReferences(first: 50) { nodes { number } }
                commits(last: 30) { nodes { commit { message } } }
              }
            }
          }
        }
      }`,
      variables: { owner: args.owner, name: args.repo, number: args.issueNumber },
    }),
  });
  if (!res.ok) return [];
  const nodes =
    (
      res.body as {
        data?: {
          repository?: {
            issue?: {
              closedByPullRequestsReferences?: {
                nodes?: Array<{
                  number?: number;
                  title?: string | null;
                  body?: string | null;
                  merged?: boolean | null;
                  mergedAt?: string | null;
                  url?: string | null;
                  baseRefName?: string | null;
                  mergeCommit?: { oid?: string | null; message?: string | null } | null;
                  author?: { login?: string | null; databaseId?: number | null } | null;
                  closingIssuesReferences?: { nodes?: Array<{ number?: number | null }> };
                  commits?: { nodes?: Array<{ commit?: { message?: string | null } | null }> };
                }>;
              };
            } | null;
          } | null;
        };
      }
    ).data?.repository?.issue?.closedByPullRequestsReferences?.nodes ?? [];

  const pulls: PublicClosingPull[] = [];
  for (const node of nodes) {
    if (node.number == null || !node.merged) continue;
    const closingIssueNumbers = (node.closingIssuesReferences?.nodes ?? [])
      .map((n) => n.number)
      .filter((n): n is number => typeof n === "number" && n > 0);
    const commitMessages = (node.commits?.nodes ?? [])
      .map((n) => n.commit?.message)
      .filter((message): message is string => Boolean(message));
    pulls.push({
      number: node.number,
      title: node.title ?? "",
      body: node.body ?? "",
      merged: true,
      authorLogin: node.author?.login?.trim() ?? "",
      authorId: typeof node.author?.databaseId === "number" ? node.author.databaseId : undefined,
      baseRef: node.baseRefName ?? "",
      defaultBranch: args.defaultBranch,
      htmlUrl: node.url ?? undefined,
      mergedAt: node.mergedAt ?? null,
      mergeCommitSha: node.mergeCommit?.oid ?? null,
      mergeCommitMessage: node.mergeCommit?.message ?? undefined,
      commitMessages: commitMessages.length ? commitMessages : undefined,
      closingIssueNumbers: closingIssueNumbers.length ? closingIssueNumbers : undefined,
    });
  }
  return pulls;
}
