import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { repos, type HfRepoType } from "../db/schema";
import type { GitHubHttp } from "../github/api";
import { HF_API, hfBountiesEnabled, readHfBotToken } from "../providers/huggingface";
import { liveHuggingFaceHttp } from "./hub";

export type HfWatchRepo = {
  type: HfRepoType;
  fullName: string;
};

export type HfWatchResult = {
  watched: boolean;
  reason: "disabled" | "no_token" | "no_webhook" | "updated" | "already" | "failed";
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function webhookRows(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) {
    return body.map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row));
  }
  const record = asRecord(body);
  const nested = record?.webhooks ?? record?.data;
  if (!Array.isArray(nested)) return [];
  return nested.map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row));
}

function pathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

function watchedItems(value: unknown): Array<{ type: string; name: string }> {
  if (!Array.isArray(value)) return [];
  const items: Array<{ type: string; name: string }> = [];
  for (const raw of value) {
    const record = asRecord(raw);
    const type = textField(record?.type);
    const name = textField(record?.name);
    if (type && name) items.push({ type, name });
  }
  return items;
}

function domainsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => textField(item)).filter(Boolean);
}

/**
 * Add one repo to the bot account webhook that posts to `/webhooks/huggingface`.
 * Hugging Face does not watch a repo until that webhook's `watched` list includes it.
 * Missing token or webhook is logged and does not fail funding. The webhook secret
 * is never logged.
 */
export async function ensureHfRepoWatched(
  repo: HfWatchRepo,
  opts: { http?: GitHubHttp; env?: NodeJS.ProcessEnv; log?: (line: string) => void } = {},
): Promise<HfWatchResult> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.error(line));
  if (!hfBountiesEnabled(env)) return { watched: false, reason: "disabled" };
  const token = readHfBotToken(env);
  if (!token) {
    log(JSON.stringify({ event: "hf_watch_sync", repo: repo.fullName, reason: "no_token" }));
    return { watched: false, reason: "no_token" };
  }
  const http = opts.http ?? liveHuggingFaceHttp;
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "github-bounties",
  };
  let listed: Awaited<ReturnType<GitHubHttp>>;
  try {
    listed = await http(`${HF_API}/settings/webhooks`, { headers });
  } catch (err) {
    log(
      JSON.stringify({
        event: "hf_watch_sync",
        repo: repo.fullName,
        reason: "list_failed",
        message: err instanceof Error ? err.message : "list failed",
      }),
    );
    return { watched: false, reason: "failed" };
  }
  let body: unknown = null;
  try {
    body = await listed.json();
  } catch {
    body = null;
  }
  if (!listed.ok) {
    log(JSON.stringify({ event: "hf_watch_sync", repo: repo.fullName, reason: "list_failed", status: listed.status }));
    return { watched: false, reason: "failed" };
  }
  const match = webhookRows(body).find((row) => pathname(textField(row.url)).endsWith("/webhooks/huggingface"));
  if (!match) {
    log(JSON.stringify({ event: "hf_watch_sync", repo: repo.fullName, reason: "no_webhook" }));
    return { watched: false, reason: "no_webhook" };
  }
  const id = textField(match.id);
  const watched = watchedItems(match.watched);
  const domains = domainsOf(match.domains);
  const already = watched.some(
    (item) => item.type === repo.type && item.name.toLowerCase() === repo.fullName.toLowerCase(),
  );
  const hasDiscussion = domains.some((domain) => domain.toLowerCase() === "discussion");
  if (already && hasDiscussion) return { watched: true, reason: "already" };
  if (!id) {
    log(JSON.stringify({ event: "hf_watch_sync", repo: repo.fullName, reason: "no_webhook" }));
    return { watched: false, reason: "no_webhook" };
  }
  const nextWatched = already ? watched : [...watched, { type: repo.type, name: repo.fullName }];
  const nextDomains = hasDiscussion ? domains : [...domains, "discussion"];
  let updated: Awaited<ReturnType<GitHubHttp>>;
  try {
    updated = await http(`${HF_API}/settings/webhooks/${id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ watched: nextWatched, domains: nextDomains }),
    });
  } catch (err) {
    log(
      JSON.stringify({
        event: "hf_watch_sync",
        repo: repo.fullName,
        reason: "update_failed",
        message: err instanceof Error ? err.message : "update failed",
      }),
    );
    return { watched: false, reason: "failed" };
  }
  if (!updated.ok) {
    log(
      JSON.stringify({
        event: "hf_watch_sync",
        repo: repo.fullName,
        reason: "update_failed",
        status: updated.status,
      }),
    );
    return { watched: false, reason: "failed" };
  }
  return { watched: true, reason: "updated" };
}

/** Best-effort watch after a bounty is funded. Flag off and non-HF bounties do no Hub call. */
export async function watchFundedHuggingFaceBounty(
  db: Database,
  bounty: { provider: string; repoId: string },
  opts: { http?: GitHubHttp; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  if (bounty.provider !== "huggingface") return;
  const env = opts.env ?? process.env;
  if (!hfBountiesEnabled(env)) return;
  const [repo] = await db
    .select({ fullName: repos.fullName, hfRepoType: repos.hfRepoType })
    .from(repos)
    .where(eq(repos.id, bounty.repoId))
    .limit(1);
  if (!repo || (repo.hfRepoType !== "model" && repo.hfRepoType !== "dataset" && repo.hfRepoType !== "space")) {
    return;
  }
  await ensureHfRepoWatched({ type: repo.hfRepoType, fullName: repo.fullName }, { http: opts.http, env });
}
