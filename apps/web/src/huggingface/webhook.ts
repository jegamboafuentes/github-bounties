import { timingSafeEqual } from "node:crypto";
import type { Database } from "../db/client";
import type { HfRepoType } from "../db/schema";
import type { DomainEmailDeps } from "../email/events";
import type { GitHubHttp } from "../github/api";
import { hfBountiesEnabled, isHuggingFaceReadError } from "../providers/huggingface";
import { applyHuggingFaceMerge, type ApplyHfMergeResult } from "./apply-merge";

export const HF_WEBHOOK_SECRET_HEADER = "X-Webhook-Secret";
export const HF_WEBHOOK_ID_HEADER = "Webhook-Id";

export type HuggingFaceWebhookDeps = {
  db: Database;
  env?: NodeJS.ProcessEnv;
  http?: GitHubHttp;
  email?: DomainEmailDeps;
};

function header(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function hfWebhookSecretsMatch(expected: string, provided: string | null): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided ?? "");
  if (left.length === 0 || left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function repoType(value: unknown): HfRepoType | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "model" || text === "models") return "model";
  if (text === "dataset" || text === "datasets") return "dataset";
  if (text === "space" || text === "spaces") return "space";
  return null;
}

/**
 * Webhook bodies can omit the merger. This only decides whether to re-read the
 * Hub discussion. Open, closed, and draft events are ignored; the poller is the
 * safety net if a merge payload is missed.
 */
export function huggingFaceWebhookTarget(body: unknown):
  | { ignore: true; reason: string }
  | {
      ignore: false;
      repoType: HfRepoType;
      owner: string;
      repo: string;
      prNumber: number;
      action: string;
    } {
  const root = asRecord(body);
  const event = asRecord(root?.event);
  const scope = typeof event?.scope === "string" ? event.scope.trim().toLowerCase() : "";
  if (scope && scope !== "discussion") return { ignore: true, reason: "not_a_discussion" };
  const discussion = asRecord(root?.discussion);
  if (discussion?.isPullRequest !== true) return { ignore: true, reason: "not_a_pull_request" };
  const status = typeof discussion.status === "string" ? discussion.status.trim().toLowerCase() : "";
  if (status === "open" || status === "closed" || status === "draft") {
    return { ignore: true, reason: "not_merged" };
  }
  const repo = asRecord(root?.repo);
  const type = repoType(repo?.type);
  const name = typeof repo?.name === "string" ? repo.name.trim() : "";
  const [owner, repoName, extra] = name.split("/");
  const num = typeof discussion.num === "number" ? discussion.num : Number(discussion.num);
  if (!type || !owner || !repoName || extra || !Number.isInteger(num) || num <= 0) {
    return { ignore: true, reason: "unusable_payload" };
  }
  const actionName = typeof event?.action === "string" && event.action.trim() ? event.action.trim() : "update";
  return { ignore: false, repoType: type, owner, repo: repoName, prNumber: num, action: `${actionName}:${type}` };
}

export async function handleHuggingFaceWebhook(
  request: { headers: Headers; body: string },
  deps: HuggingFaceWebhookDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const env = deps.env ?? process.env;
  const secret = env.HF_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) {
    return {
      status: 503,
      body: {
        ok: false,
        error: "missing_hf_webhook_secret",
        message: "HF_WEBHOOK_SECRET is unset. Hugging Face webhook verification is fail-closed.",
      },
    };
  }
  const provided = header(request.headers, HF_WEBHOOK_SECRET_HEADER);
  if (!hfWebhookSecretsMatch(secret, provided)) {
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  }
  const deliveryId = header(request.headers, HF_WEBHOOK_ID_HEADER);
  if (!deliveryId) {
    return { status: 400, body: { ok: false, error: "missing_webhook_id" } };
  }
  if (!hfBountiesEnabled(env)) {
    return { status: 200, body: { ok: true, skipped: "hf_disabled" } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.body);
  } catch {
    return { status: 400, body: { ok: false, error: "invalid_json" } };
  }
  const target = huggingFaceWebhookTarget(parsed);
  if (target.ignore) {
    return { status: 200, body: { ok: true, ignored: target.reason } };
  }
  try {
    const result: ApplyHfMergeResult = await applyHuggingFaceMerge(
      deps.db,
      {
        deliveryId,
        event: "discussion",
        action: target.action,
        target,
      },
      { http: deps.http, env, email: deps.email },
    );
    return { status: result.httpStatus, body: result.body };
  } catch (err) {
    const code = isHuggingFaceReadError(err) ? err.code : "hf_unavailable";
    return {
      status: 503,
      body: {
        ok: false,
        error: code,
        message: "Hugging Face could not be re-read. The delivery was not recorded.",
      },
    };
  }
}
