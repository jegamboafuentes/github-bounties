import type { HfRepoType } from "../db/schema";
import type { GitHubHttp } from "../github/api";
import {
  ProviderNotSupportedError,
  type FetchedIssue,
  type IssueRef,
  type PrRef,
  type ProviderCallOpts,
  type RepoProvider,
} from "./types";

export const HF_SITE = "https://huggingface.co";
export const HF_API = "https://huggingface.co/api";
/** Public discussion reads abort after this. Injected test HTTP is not timed here. */
export const HF_DISCUSSION_TIMEOUT_MS = 10_000;

const DISCUSSION_URL =
  /^(?:https?:\/\/)?(?:www\.)?huggingface\.co\/(?:(models|datasets|spaces)\/)?([^/?#]+)\/([^/?#]+)\/discussions\/(\d+)\/?(?:[?#].*)?$/i;

const HF_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

export type HuggingFaceReadCode =
  | "hf_discussion_not_found"
  | "hf_not_a_discussion"
  | "hf_discussion_closed"
  | "hf_discussion_inaccessible"
  | "hf_rate_limited"
  | "hf_timeout"
  | "hf_unavailable";

export class HuggingFaceReadError extends Error {
  readonly code: HuggingFaceReadCode;
  readonly status: number;
  /** Upstream Retry-After header, when Hugging Face sent one. */
  readonly retryAfter: string | null;

  constructor(code: HuggingFaceReadCode, status: number, message: string, retryAfter: string | null = null) {
    super(message);
    this.name = "HuggingFaceReadError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function isHuggingFaceReadError(err: unknown): err is HuggingFaceReadError {
  return err instanceof HuggingFaceReadError;
}

/** Off unless the value is exactly `1`. */
export function hfBountiesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HF_BOUNTIES_ENABLED === "1";
}

export function readHfBotToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = env.HF_BOT_TOKEN?.trim();
  return token || null;
}

export function hfProviderRepoId(type: HfRepoType, fullName: string): string {
  return `${type}:${fullName}`;
}

export function huggingFaceDiscussionUrl(type: HfRepoType, fullName: string, num: number): string {
  const prefix = type === "dataset" ? "datasets/" : type === "space" ? "spaces/" : "";
  return `${HF_SITE}/${prefix}${fullName}/discussions/${num}`;
}

function apiPrefix(type: HfRepoType): "models" | "datasets" | "spaces" {
  if (type === "dataset") return "datasets";
  if (type === "space") return "spaces";
  return "models";
}

function repoTypeFromPrefix(prefix: string | undefined): HfRepoType {
  if (prefix?.toLowerCase() === "datasets") return "dataset";
  if (prefix?.toLowerCase() === "spaces") return "space";
  return "model";
}

function isHfName(value: string): boolean {
  return HF_NAME.test(value) && value !== "." && value !== "..";
}

function unsupported(): never {
  throw new ProviderNotSupportedError("huggingface");
}

type DiscussionAuthor = { _id?: unknown; name?: unknown };
type DiscussionEvent = {
  type?: unknown;
  data?: { hidden?: unknown; latest?: { raw?: unknown } };
};
type DiscussionPayload = {
  title?: unknown;
  status?: unknown;
  isPullRequest?: unknown;
  author?: DiscussionAuthor;
  events?: unknown;
  repo?: { name?: unknown; type?: unknown };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function hfMessage(body: unknown): string {
  const record = asRecord(body);
  const error = record?.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  const message = record?.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  return "";
}

export function classifyHuggingFaceStatus(
  status: number,
  body: unknown,
  retryAfter: string | null = null,
): HuggingFaceReadError | null {
  if (status >= 200 && status < 300) return null;
  const message = hfMessage(body);
  if (status === 404) {
    return new HuggingFaceReadError(
      "hf_discussion_not_found",
      status,
      message || "Hugging Face discussion was not found.",
    );
  }
  // Only a real upstream 429. A 5xx body that mentions "rate limit" stays hf_unavailable.
  if (status === 429) {
    return new HuggingFaceReadError(
      "hf_rate_limited",
      status,
      message || "Hugging Face rate limit reached.",
      retryAfter,
    );
  }
  if (status === 401 || status === 403) {
    return new HuggingFaceReadError(
      "hf_discussion_inaccessible",
      status,
      message || "Hugging Face discussion is private or inaccessible.",
    );
  }
  return new HuggingFaceReadError(
    "hf_unavailable",
    status,
    message || `Hugging Face request failed (HTTP ${status}).`,
  );
}

function isTimeout(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  return name === "TimeoutError" || name === "AbortError";
}

function defaultHttp(
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) {
  return fetch(input, { ...init, signal: AbortSignal.timeout(HF_DISCUSSION_TIMEOUT_MS) }).then((res) => ({
    ok: res.ok,
    status: res.status,
    headers: res.headers,
    json: () => res.json() as Promise<unknown>,
  }));
}

/** Bearer token for every Hub read (discussion, pull request, and any later repo read). */
export function huggingFaceHubHeaders(env: NodeJS.ProcessEnv | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "github-bounties",
  };
  const token = readHfBotToken(env);
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function hubPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

function headerEntries(headers: Headers | Record<string, string> | undefined): Array<[string, string]> {
  if (!headers) return [];
  if (typeof (headers as Headers).forEach === "function") {
    const rows: Array<[string, string]> = [];
    (headers as Headers).forEach((value, key) => rows.push([key, value]));
    return rows;
  }
  return Object.entries(headers);
}

function headerValue(headers: Headers | Record<string, string> | undefined, name: string): string | null {
  const found = headerEntries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = found?.[1]?.trim();
  return value || null;
}

const DIAGNOSTIC_HEADER = /^(ratelimit(?:-.+)?|retry-after|x-error-code|x-error-message)$/i;

/** Structured Cloud Run line. Path only: no query string and no bearer token. */
export function logHuggingFaceHubFailure(args: {
  status: number;
  url: string;
  botToken: boolean;
  headers?: Headers | Record<string, string>;
}): void {
  const rateLimit: Record<string, string> = {};
  for (const [key, value] of headerEntries(args.headers)) {
    if (DIAGNOSTIC_HEADER.test(key)) rateLimit[key.toLowerCase()] = value;
  }
  console.error(
    JSON.stringify({
      event: "hf_hub_read",
      status: args.status,
      path: hubPath(args.url),
      botToken: args.botToken,
      rateLimit,
    }),
  );
}

function firstCommentBody(events: unknown): string | null {
  if (!Array.isArray(events)) return null;
  for (const event of events) {
    const row = event as DiscussionEvent;
    if (row?.type !== "comment") continue;
    if (row.data?.hidden === true) return null;
    const raw = row.data?.latest?.raw;
    return typeof raw === "string" && raw.trim() ? raw : null;
  }
  return null;
}

function knownRepoType(value: unknown): HfRepoType | null {
  if (value === "model" || value === "dataset" || value === "space") return value;
  return null;
}

function canonicalRepo(
  fallback: IssueRef,
  payload: DiscussionPayload,
): { type: HfRepoType; owner: string; repo: string; fullName: string } {
  const type = knownRepoType(payload.repo?.type) ?? fallback.hfRepoType ?? "model";
  const name = typeof payload.repo?.name === "string" ? payload.repo.name.trim() : "";
  const slash = name.indexOf("/");
  if (slash > 0 && slash < name.length - 1) {
    const owner = name.slice(0, slash);
    const repo = name.slice(slash + 1);
    if (isHfName(owner) && isHfName(repo) && !repo.includes("/")) {
      return { type, owner, repo, fullName: `${owner}/${repo}` };
    }
  }
  return {
    type,
    owner: fallback.owner,
    repo: fallback.repo,
    fullName: fallback.fullName,
  };
}

function assertOpenDiscussion(payload: DiscussionPayload, ref: string): void {
  if (payload.isPullRequest === true) {
    throw new HuggingFaceReadError(
      "hf_not_a_discussion",
      200,
      `${ref} is a pull request. Bounties attach to Hugging Face discussions, not pull requests.`,
    );
  }
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
  if (status !== "open") {
    throw new HuggingFaceReadError(
      "hf_discussion_closed",
      200,
      `${ref} is ${status || "not open"}. Post a bounty on an open discussion.`,
    );
  }
}

function emptyRepo(fullName: string) {
  return {
    fullName,
    private: false as boolean | null,
    createdAt: null,
    description: null,
    language: null,
    languages: [] as string[],
    readmeBlurb: null,
    stars: null,
    ownerId: null,
    ownerLogin: null as string | null,
    githubRepoId: null,
    defaultBranch: null,
  };
}

export type HuggingFaceDiscussion = {
  title: string;
  body: string | null;
  status: string;
  isPullRequest: boolean;
  authorId: string | null;
  authorLogin: string | null;
  repoType: HfRepoType;
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
};

/**
 * Reads one discussion, including a pull request. Does not reject closed
 * threads or pull requests. Create-bounty still applies those checks.
 */
export async function fetchHuggingFaceDiscussion(
  ref: IssueRef,
  opts: ProviderCallOpts = {},
): Promise<HuggingFaceDiscussion> {
  const type = ref.hfRepoType;
  if (!type) {
    throw new HuggingFaceReadError(
      "hf_unavailable",
      0,
      "Hugging Face discussion is missing a repo type.",
    );
  }
  const http: GitHubHttp = opts.http ?? defaultHttp;
  const url = `${HF_API}/${apiPrefix(type)}/${ref.owner}/${ref.repo}/discussions/${ref.issueNumber}`;
  const botToken = Boolean(readHfBotToken(opts.env));
  let res: Awaited<ReturnType<GitHubHttp>>;
  try {
    res = await http(url, { headers: huggingFaceHubHeaders(opts.env) });
  } catch (err) {
    if (isHuggingFaceReadError(err)) throw err;
    if (isTimeout(err)) {
      throw new HuggingFaceReadError(
        "hf_timeout",
        0,
        "Hugging Face did not respond before the discussion read timed out.",
      );
    }
    throw new HuggingFaceReadError(
      "hf_unavailable",
      0,
      "Hugging Face could not be reached.",
    );
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    logHuggingFaceHubFailure({ status: res.status, url, botToken, headers: res.headers });
  }
  const retryAfter = headerValue(res.headers, "retry-after");
  const failed = classifyHuggingFaceStatus(res.status, body, retryAfter);
  if (failed) throw failed;
  const payload = (asRecord(body) ?? {}) as DiscussionPayload;
  const repo = canonicalRepo(ref, payload);
  const author = payload.author;
  const authorId = typeof author?._id === "string" ? author._id.trim() : "";
  const authorLogin = typeof author?.name === "string" ? author.name.trim() : "";
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
  return {
    title: typeof payload.title === "string" ? payload.title.trim() : "",
    body: firstCommentBody(payload.events),
    status,
    isPullRequest: payload.isPullRequest === true,
    authorId: authorId || null,
    authorLogin: authorLogin || null,
    repoType: repo.type,
    owner: repo.owner,
    repo: repo.repo,
    fullName: repo.fullName,
    htmlUrl: huggingFaceDiscussionUrl(repo.type, repo.fullName, ref.issueNumber),
  };
}

/**
 * Read-side Hugging Face adapter. Discussion URL parse and fetch are live.
 * Pull-request URLs parse here. Merge detection and payout stay
 * `provider_not_supported` until a later PR.
 */
export const huggingfaceProvider: RepoProvider = {
  id: "huggingface",

  parseIssueUrl(raw: string): IssueRef | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const match = trimmed.match(DISCUSSION_URL);
    if (!match) return null;
    const owner = match[2] ?? "";
    const repo = match[3] ?? "";
    const issueNumber = Number.parseInt(match[4] ?? "", 10);
    if (!isHfName(owner) || !isHfName(repo)) return null;
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) return null;
    const hfRepoType = repoTypeFromPrefix(match[1]);
    const fullName = `${owner}/${repo}`;
    return {
      provider: "huggingface",
      owner,
      repo,
      fullName,
      issueNumber,
      hfRepoType,
      url: huggingFaceDiscussionUrl(hfRepoType, fullName, issueNumber),
    };
  },

  async fetchIssue(ref: IssueRef, opts: ProviderCallOpts = {}): Promise<FetchedIssue> {
    const discussion = await fetchHuggingFaceDiscussion(ref, opts);
    const label = `${discussion.fullName}#${ref.issueNumber}`;
    assertOpenDiscussion(
      { isPullRequest: discussion.isPullRequest, status: discussion.status },
      label,
    );
    if (!discussion.title) {
      throw new HuggingFaceReadError(
        "hf_unavailable",
        200,
        `Hugging Face discussion ${label} did not include a title.`,
      );
    }
    return {
      title: discussion.title,
      body: discussion.body,
      state: "open",
      author: { id: discussion.authorId, login: discussion.authorLogin },
      htmlUrl: discussion.htmlUrl,
      pullRequest: false,
      repo: {
        ...emptyRepo(discussion.fullName),
        ownerLogin: discussion.owner,
        hfRepoType: discussion.repoType,
      },
    };
  },

  parsePrUrl(raw: string): PrRef | null {
    const issue = this.parseIssueUrl(raw);
    if (!issue?.hfRepoType) return null;
    return {
      provider: "huggingface",
      owner: issue.owner,
      repo: issue.repo,
      fullName: issue.fullName,
      prNumber: issue.issueNumber,
      url: issue.url,
      hfRepoType: issue.hfRepoType,
    };
  },
  verifyMerge() {
    unsupported();
  },
  repoMeta() {
    unsupported();
  },
  identitiesMatch() {
    unsupported();
  },
  findLinkedUser() {
    unsupported();
  },
  identityForUser() {
    unsupported();
  },
  listClosingPulls() {
    unsupported();
  },
  mergeDeliveryPayload() {
    unsupported();
  },
};
