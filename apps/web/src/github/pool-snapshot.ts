/**
 * Merge-time GitHub backfill for pool eligibility (ADR 0003 / V2-2).
 *
 * Source of truth is this snapshot — not the incremental webhook stream.
 * `GET …/pulls/{n}/commits` at freeze; no reflog. Cross-fork PRs into the
 * bounty repo count; PRs whose base is another repo do not.
 */

import type {
  PoolCommitAuthor,
  PoolPullRequest,
} from "../lib/pool-eligibility";
import type { GitHubWebhookPayload } from "../webhooks/types";
import {
  GITHUB_API,
  createInstallationToken,
  githubApiHeaders,
  type GitHubHttp,
  type InstallationId,
} from "./api";

function defaultHttp(
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) {
  return fetch(input, init);
}

type RawUser = {
  login?: string | null;
  id?: number | null;
  type?: string | null;
};

type RawPull = {
  number?: number;
  title?: string | null;
  body?: string | null;
  created_at?: string | null;
  html_url?: string | null;
  draft?: boolean | null;
  merged?: boolean | null;
  state?: string | null;
  user?: RawUser | null;
  base?: { repo?: { full_name?: string | null } | null } | null;
  head?: { repo?: { full_name?: string | null } | null } | null;
};

type RawCommit = {
  sha?: string | null;
  author?: RawUser | null;
  commit?: { message?: string | null } | null;
};

function actorFromUser(user: RawUser | null | undefined): PoolCommitAuthor | null {
  const login = user?.login?.trim();
  if (!login) return null;
  return {
    login,
    githubId: typeof user?.id === "number" ? user.id : undefined,
  };
}

function repoFullNameFromUrl(htmlUrl: string | null | undefined): string | null {
  if (!htmlUrl) return null;
  const match = htmlUrl.match(/github\.com\/([^/]+\/[^/]+)\//i);
  return match?.[1] ?? null;
}

export function poolPullRequestFromWebhook(
  payload: GitHubWebhookPayload,
  extras: {
    commitAuthorsAtFreeze?: PoolCommitAuthor[];
    commitsAtFreeze?: PoolPullRequest["commitsAtFreeze"];
    commitMessages?: string[];
    closingIssueNumbers?: number[];
  } = {},
): PoolPullRequest | null {
  const raw = payload.pull_request;
  const number = raw?.number;
  if (!raw || number == null) return null;
  const authorLogin = raw.user?.login?.trim() ?? "";
  const authorId = typeof raw.user?.id === "number" ? raw.user.id : 0;
  const baseRepo =
    raw.base?.repo?.full_name ?? payload.repository?.full_name ?? "";
  const commits = extras.commitsAtFreeze;
  const commitAuthors =
    extras.commitAuthorsAtFreeze ??
    commits?.flatMap((c) => c.authors) ??
    (authorLogin ? [{ login: authorLogin, githubId: authorId || undefined }] : []);
  const commitMessages =
    extras.commitMessages ??
    commits?.map((c) => c.message).filter((m): m is string => Boolean(m)) ??
    raw.commit_messages ??
    undefined;

  return {
    number,
    title: raw.title ?? "",
    body: raw.body ?? "",
    authorLogin,
    authorId,
    authorType: raw.user?.type ?? "User",
    createdAt: raw.created_at ?? raw.merged_at ?? new Date().toISOString(),
    draft: Boolean(raw.draft),
    merged: Boolean(raw.merged),
    closed: payload.action === "closed" || Boolean(raw.merged),
    baseRepositoryFullName: baseRepo,
    headRepositoryFullName: raw.head?.repo?.full_name ?? undefined,
    htmlUrl: raw.html_url ?? undefined,
    commitAuthorsAtFreeze: commitAuthors,
    commitsAtFreeze: commits,
    commitMessages,
    closingIssueNumbers: extras.closingIssueNumbers ?? raw.closing_issue_numbers ?? undefined,
  };
}

function toPoolPullRequest(
  pull: RawPull,
  commits: RawCommit[],
  bountyRepo: string,
): PoolPullRequest | null {
  const number = pull.number;
  const authorLogin = pull.user?.login?.trim() ?? "";
  const authorId = typeof pull.user?.id === "number" ? pull.user.id : 0;
  if (number == null || !authorLogin) return null;
  const baseRepo = (pull.base?.repo?.full_name ?? bountyRepo).toLowerCase();
  if (baseRepo !== bountyRepo.toLowerCase()) return null;

  const commitsAtFreeze = commits
    .map((commit) => {
      const sha = commit.sha?.trim();
      const author = actorFromUser(commit.author);
      if (!sha) return null;
      return {
        sha,
        authors: author ? [author] : [],
        message: commit.commit?.message ?? undefined,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const commitAuthorsAtFreeze: PoolCommitAuthor[] = [];
  const seen = new Set<string>();
  for (const commit of commitsAtFreeze) {
    for (const author of commit.authors) {
      const key = `${author.githubId ?? ""}:${author.login.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      commitAuthorsAtFreeze.push(author);
    }
  }

  return {
    number,
    title: pull.title ?? "",
    body: pull.body ?? "",
    authorLogin,
    authorId,
    authorType: pull.user?.type ?? "User",
    createdAt: pull.created_at ?? new Date().toISOString(),
    draft: Boolean(pull.draft),
    merged: Boolean(pull.merged),
    closed: pull.state === "closed" || Boolean(pull.merged),
    baseRepositoryFullName: pull.base?.repo?.full_name ?? bountyRepo,
    headRepositoryFullName: pull.head?.repo?.full_name ?? undefined,
    htmlUrl: pull.html_url ?? undefined,
    commitAuthorsAtFreeze,
    commitsAtFreeze,
    commitMessages: commitsAtFreeze
      .map((c) => c.message)
      .filter((m): m is string => Boolean(m)),
  };
}

async function getJson(
  http: GitHubHttp,
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await http(url, { headers });
  return { ok: res.ok, status: res.status, body: await res.json() };
}

async function listCommitPages(
  http: GitHubHttp,
  owner: string,
  repo: string,
  pullNumber: number,
  headers: Record<string, string>,
): Promise<RawCommit[]> {
  const commits: RawCommit[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const res = await getJson(
      http,
      `${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/commits?per_page=100&page=${page}`,
      headers,
    );
    if (!res.ok || !Array.isArray(res.body)) break;
    const batch = res.body as RawCommit[];
    commits.push(...batch);
    if (batch.length < 100) break;
  }
  return commits;
}

async function searchPrNumbers(
  http: GitHubHttp,
  owner: string,
  repo: string,
  issueNumber: number,
  headers: Record<string, string>,
): Promise<number[]> {
  const numbers = new Set<number>();
  const q = encodeURIComponent(`repo:${owner}/${repo} is:pr #${issueNumber}`);
  for (let page = 1; page <= 3; page += 1) {
    const res = await getJson(
      http,
      `${GITHUB_API}/search/issues?q=${q}&per_page=100&page=${page}`,
      headers,
    );
    if (!res.ok) break;
    const body = res.body as {
      items?: Array<{ number?: number; pull_request?: unknown }>;
    };
    const items = body.items ?? [];
    for (const item of items) {
      if (item.pull_request && typeof item.number === "number") {
        numbers.add(item.number);
      }
    }
    if (items.length < 100) break;
  }
  return [...numbers];
}

async function timelinePrNumbers(
  http: GitHubHttp,
  owner: string,
  repo: string,
  issueNumber: number,
  headers: Record<string, string>,
): Promise<number[]> {
  const bountyRepo = `${owner}/${repo}`.toLowerCase();
  const numbers = new Set<number>();
  for (let page = 1; page <= 5; page += 1) {
    const res = await getJson(
      http,
      `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/timeline?per_page=100&page=${page}`,
      headers,
    );
    if (!res.ok || !Array.isArray(res.body)) break;
    const events = res.body as Array<{
      event?: string;
      source?: {
        issue?: {
          number?: number;
          pull_request?: unknown;
          html_url?: string | null;
          repository?: { full_name?: string | null };
        };
      };
    }>;
    for (const event of events) {
      if (event.event !== "cross-referenced" && event.event !== "connected") {
        continue;
      }
      const issue = event.source?.issue;
      if (!issue?.pull_request || typeof issue.number !== "number") continue;
      const sourceRepo = (
        issue.repository?.full_name ??
        repoFullNameFromUrl(issue.html_url) ??
        ""
      ).toLowerCase();
      if (sourceRepo && sourceRepo !== bountyRepo) continue;
      numbers.add(issue.number);
    }
    if (events.length < 100) break;
  }
  return [...numbers];
}

/**
 * List PRs that reference funded `#N` in **this** repository, with commit
 * authors as of this call (freeze time). Does not walk reflog.
 */
export async function fetchPoolPullRequests(args: {
  owner: string;
  repo: string;
  issueNumber: number;
  installationId?: InstallationId | null;
  includePullNumbers?: number[];
  http?: GitHubHttp;
  jwt?: string;
}): Promise<PoolPullRequest[]> {
  if (args.installationId == null) return [];
  const token = await createInstallationToken(args.installationId, {
    http: args.http,
    jwt: args.jwt,
  });
  const http = args.http ?? defaultHttp;
  const headers = githubApiHeaders(token);
  const bountyRepo = `${args.owner}/${args.repo}`;

  const numbers = new Set<number>(args.includePullNumbers ?? []);
  for (const n of await searchPrNumbers(http, args.owner, args.repo, args.issueNumber, headers)) {
    numbers.add(n);
  }
  for (const n of await timelinePrNumbers(
    http,
    args.owner,
    args.repo,
    args.issueNumber,
    headers,
  )) {
    numbers.add(n);
  }

  const pulls: PoolPullRequest[] = [];
  for (const number of [...numbers].sort((a, b) => a - b)) {
    const res = await getJson(
      http,
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/pulls/${number}`,
      headers,
    );
    if (!res.ok || !res.body || typeof res.body !== "object") continue;
    const commits = await listCommitPages(http, args.owner, args.repo, number, headers);
    const mapped = toPoolPullRequest(res.body as RawPull, commits, bountyRepo);
    if (mapped) pulls.push(mapped);
  }
  return pulls;
}
