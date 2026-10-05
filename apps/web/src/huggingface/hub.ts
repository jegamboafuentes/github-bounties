import type { HfRepoType } from "../db/schema";
import type { GitHubHttp } from "../github/api";
import {
  classifyHuggingFaceStatus,
  HF_API,
  HF_DISCUSSION_TIMEOUT_MS,
  HuggingFaceReadError,
  huggingFaceHubHeaders,
  isHuggingFaceReadError,
} from "../providers/huggingface";

export const liveHuggingFaceHttp: GitHubHttp = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(HF_DISCUSSION_TIMEOUT_MS) }).then((res) => ({
    ok: res.ok,
    status: res.status,
    headers: res.headers,
    json: () => res.json() as Promise<unknown>,
  }));

function apiPrefix(type: HfRepoType): "models" | "datasets" | "spaces" {
  if (type === "dataset") return "datasets";
  if (type === "space") return "spaces";
  return "models";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isTimeout(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  return name === "TimeoutError" || name === "AbortError";
}

async function readJson(http: GitHubHttp, url: string, env: NodeJS.ProcessEnv | undefined): Promise<{
  status: number;
  body: unknown;
}> {
  let res: Awaited<ReturnType<GitHubHttp>>;
  try {
    res = await http(url, { headers: huggingFaceHubHeaders(env) });
  } catch (err) {
    if (isHuggingFaceReadError(err)) throw err;
    if (isTimeout(err)) {
      throw new HuggingFaceReadError("hf_timeout", 0, "Hugging Face did not respond before the read timed out.");
    }
    throw new HuggingFaceReadError("hf_unavailable", 0, "Hugging Face could not be reached.");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function branchNames(body: unknown): string[] {
  const record = asRecord(body);
  const raw = record?.branches ?? body;
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) names.push(item.trim());
    else {
      const name = textField(asRecord(item)?.name);
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * Default branch for a merge. `main` wins when it exists. A missing repo
 * falls back to `main`. Rate limits and upstream failures throw so the caller
 * does not write a claim.
 */
export async function fetchHuggingFaceDefaultBranch(
  repo: { type: HfRepoType; owner: string; repo: string },
  opts: { http: GitHubHttp; env?: NodeJS.ProcessEnv },
): Promise<string> {
  const url = `${HF_API}/${apiPrefix(repo.type)}/${repo.owner}/${repo.repo}/refs`;
  const { status, body } = await readJson(opts.http, url, opts.env);
  if (status === 404) return "main";
  const failed = classifyHuggingFaceStatus(status, body);
  if (failed) throw failed;
  const names = branchNames(body);
  const main = names.find((name) => name.toLowerCase() === "main");
  return main ?? names[0] ?? "main";
}

function memberNames(body: unknown): string[] {
  const raw = Array.isArray(body) ? body : asRecord(body)?.members;
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      names.push(item.trim());
      continue;
    }
    const record = asRecord(item);
    const name =
      textField(record?.name) ||
      textField(record?.user) ||
      textField(record?.username) ||
      textField(record?.fullname);
    if (name) names.push(name);
  }
  return names;
}

/**
 * Public org members. A user namespace is 404 and returns an empty list.
 * Any other failure throws so an insider is not treated as an outsider.
 */
export async function fetchHuggingFaceOrgMembers(
  owner: string,
  opts: { http: GitHubHttp; env?: NodeJS.ProcessEnv },
): Promise<string[]> {
  const url = `${HF_API}/organizations/${owner}/members`;
  const { status, body } = await readJson(opts.http, url, opts.env);
  if (status === 404) return [];
  const failed = classifyHuggingFaceStatus(status, body);
  if (failed) throw failed;
  return memberNames(body);
}

export function orgMemberLogin(members: readonly string[], login: string | null): boolean {
  const name = login?.trim().toLowerCase() ?? "";
  if (!name) return false;
  return members.some((member) => member.trim().toLowerCase() === name);
}
