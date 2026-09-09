import { readGitHubAppId, readGitHubAppOAuth, readGitHubAppPrivateKey } from "../webhooks/env";
import { signGitHubAppJwt } from "./jwt";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_ACCEPT = "application/vnd.github+json";
export const GITHUB_API_VERSION = "2022-11-28";

export type GitHubHttp = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type InstallationInfo = {
  id: number;
  accountLogin: string;
  accountId: number;
  accountType: string;
  suspended: boolean;
};

export type InstallationRepo = {
  githubRepoId: bigint;
  fullName: string;
};

export type GitHubIdentity = {
  githubId: bigint;
  githubLogin: string;
  githubAvatarUrl?: string;
};

function defaultHttp(
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) {
  return fetch(input, init);
}

function apiHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    accept: GITHUB_ACCEPT,
    "x-github-api-version": GITHUB_API_VERSION,
    "user-agent": "github-bounties",
    authorization: `Bearer ${token}`,
    ...extra,
  };
}

export function createAppJwt(env: NodeJS.ProcessEnv = process.env): string {
  const appId = readGitHubAppId(env);
  const pem = readGitHubAppPrivateKey(env);
  if (!appId || !pem) {
    throw new Error("GitHub App JWT requires GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY");
  }
  return signGitHubAppJwt(appId, pem);
}

/** Confirm an installation exists. Do not trust `installation_id` from the query string alone. */
export async function confirmInstallation(
  installationId: number | string,
  opts: { http?: GitHubHttp; jwt?: string } = {},
): Promise<InstallationInfo> {
  const http = opts.http ?? defaultHttp;
  const jwt = opts.jwt ?? createAppJwt();
  const res = await http(`${GITHUB_API}/app/installations/${installationId}`, {
    headers: apiHeaders(jwt),
  });
  if (!res.ok) {
    throw new Error(`GitHub installation ${installationId} not confirmed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as {
    id?: number;
    suspended_at?: string | null;
    account?: { login?: string; id?: number; type?: string };
  };
  if (!body.id || !body.account?.login || body.account.id == null) {
    throw new Error("GitHub installation payload missing account");
  }
  return {
    id: body.id,
    accountLogin: body.account.login,
    accountId: body.account.id,
    accountType: body.account.type ?? "User",
    suspended: Boolean(body.suspended_at),
  };
}

export async function createInstallationToken(
  installationId: number | string,
  opts: { http?: GitHubHttp; jwt?: string } = {},
): Promise<string> {
  const http = opts.http ?? defaultHttp;
  const jwt = opts.jwt ?? createAppJwt();
  const res = await http(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: apiHeaders(jwt),
  });
  if (!res.ok) {
    throw new Error(`GitHub installation token failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("GitHub installation token missing");
  return body.token;
}

export async function listInstallationRepos(
  installationId: number | string,
  opts: { http?: GitHubHttp; jwt?: string } = {},
): Promise<InstallationRepo[]> {
  const token = await createInstallationToken(installationId, opts);
  const http = opts.http ?? defaultHttp;
  const repos: InstallationRepo[] = [];
  let page = 1;
  while (page <= 10) {
    const res = await http(`${GITHUB_API}/installation/repositories?per_page=100&page=${page}`, {
      headers: apiHeaders(token),
    });
    if (!res.ok) {
      throw new Error(`GitHub installation repositories failed (HTTP ${res.status})`);
    }
    const body = (await res.json()) as {
      repositories?: Array<{ id?: number; full_name?: string }>;
    };
    const batch = body.repositories ?? [];
    for (const repo of batch) {
      if (repo.id != null && repo.full_name) {
        repos.push({ githubRepoId: BigInt(repo.id), fullName: repo.full_name });
      }
    }
    if (batch.length < 100) break;
    page += 1;
  }
  return repos;
}

export async function exchangeOAuthCode(
  code: string,
  redirectUri: string,
  opts: { http?: GitHubHttp; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const { clientId, clientSecret } = readGitHubAppOAuth(opts.env ?? process.env);
  if (!clientId || !clientSecret) {
    throw new Error("GitHub App OAuth requires GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET");
  }
  const http = opts.http ?? defaultHttp;
  const res = await http("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "github-bounties",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`GitHub OAuth exchange failed (${body.error ?? res.status})`);
  }
  return body.access_token;
}

export async function getAuthenticatedGitHubUser(
  userToken: string,
  opts: { http?: GitHubHttp } = {},
): Promise<GitHubIdentity> {
  const http = opts.http ?? defaultHttp;
  const res = await http(`${GITHUB_API}/user`, {
    headers: apiHeaders(userToken),
  });
  if (!res.ok) {
    throw new Error(`GitHub /user failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as {
    id?: number;
    login?: string;
    avatar_url?: string;
  };
  if (body.id == null || !body.login) {
    throw new Error("GitHub /user missing id or login");
  }
  return {
    githubId: BigInt(body.id),
    githubLogin: body.login,
    githubAvatarUrl: body.avatar_url,
  };
}

export async function fetchMergeSurfaces(args: {
  owner: string;
  repo: string;
  pullNumber: number;
  mergeCommitSha?: string | null;
  installationId?: number | string | null;
  http?: GitHubHttp;
  jwt?: string;
}): Promise<{
  mergeCommitMessage?: string;
  commitMessages?: string[];
  closingIssueNumbers?: number[];
}> {
  if (args.installationId == null) return {};
  const token = await createInstallationToken(args.installationId, {
    http: args.http,
    jwt: args.jwt,
  });
  const http = args.http ?? defaultHttp;
  const extras: {
    mergeCommitMessage?: string;
    commitMessages?: string[];
    closingIssueNumbers?: number[];
  } = {};

  if (args.mergeCommitSha) {
    const res = await http(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/commits/${args.mergeCommitSha}`,
      { headers: apiHeaders(token) },
    );
    if (res.ok) {
      const body = (await res.json()) as { commit?: { message?: string } };
      if (body.commit?.message) extras.mergeCommitMessage = body.commit.message;
    }
  }

  const gql = await http(`${GITHUB_API}/graphql`, {
    method: "POST",
    headers: {
      ...apiHeaders(token),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: `query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            closingIssuesReferences(first: 50) { nodes { number } }
            commits(last: 50) { nodes { commit { message } } }
          }
        }
      }`,
      variables: {
        owner: args.owner,
        name: args.repo,
        number: args.pullNumber,
      },
    }),
  });
  if (gql.ok) {
    const body = (await gql.json()) as {
      data?: {
        repository?: {
          pullRequest?: {
            closingIssuesReferences?: { nodes?: Array<{ number?: number }> };
            commits?: { nodes?: Array<{ commit?: { message?: string } }> };
          };
        };
      };
    };
    const pr = body.data?.repository?.pullRequest;
    const nums = (pr?.closingIssuesReferences?.nodes ?? [])
      .map((n) => n.number)
      .filter((n): n is number => typeof n === "number");
    if (nums.length) extras.closingIssueNumbers = nums;
    const messages = (pr?.commits?.nodes ?? [])
      .map((n) => n.commit?.message)
      .filter((m): m is string => Boolean(m));
    if (messages.length) extras.commitMessages = messages;
  }

  return extras;
}

export type GitHubIssueSnapshot = {
  title: string;
  body: string | null;
  htmlUrl: string;
  state: string;
};

export async function fetchIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  opts: { installationId: number | string; http?: GitHubHttp; jwt?: string },
): Promise<GitHubIssueSnapshot> {
  const token = await createInstallationToken(opts.installationId, {
    http: opts.http,
    jwt: opts.jwt,
  });
  const http = opts.http ?? defaultHttp;
  const res = await http(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}`,
    { headers: apiHeaders(token) },
  );
  if (!res.ok) {
    throw new Error(`GitHub issue ${owner}/${repo}#${issueNumber} failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as {
    title?: string;
    body?: string | null;
    html_url?: string;
    state?: string;
    pull_request?: unknown;
  };
  if (body.pull_request) {
    throw new Error(`${owner}/${repo}#${issueNumber} is a pull request, not an issue`);
  }
  if (!body.title) throw new Error("GitHub issue missing title");
  return {
    title: body.title,
    body: body.body ?? null,
    htmlUrl: body.html_url ?? `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
    state: body.state ?? "open",
  };
}

export async function createIssueComment(args: {
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
  installationId: number | string;
  http?: GitHubHttp;
  jwt?: string;
}): Promise<{ ok: boolean; status: number }> {
  const token = await createInstallationToken(args.installationId, {
    http: args.http,
    jwt: args.jwt,
  });
  const http = args.http ?? defaultHttp;
  const res = await http(
    `${GITHUB_API}/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}/comments`,
    {
      method: "POST",
      headers: { ...apiHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ body: args.body }),
    },
  );
  return { ok: res.ok, status: res.status };
}

export async function addIssueLabels(args: {
  owner: string;
  repo: string;
  issueNumber: number;
  labels: string[];
  installationId: number | string;
  http?: GitHubHttp;
  jwt?: string;
}): Promise<{ ok: boolean; status: number }> {
  const token = await createInstallationToken(args.installationId, {
    http: args.http,
    jwt: args.jwt,
  });
  const http = args.http ?? defaultHttp;
  const res = await http(
    `${GITHUB_API}/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}/labels`,
    {
      method: "POST",
      headers: { ...apiHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ labels: args.labels }),
    },
  );
  return { ok: res.ok, status: res.status };
}
