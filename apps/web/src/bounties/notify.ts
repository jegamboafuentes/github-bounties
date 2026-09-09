import {
  addIssueLabels,
  createIssueComment,
  type GitHubHttp,
} from "../github/api";
import { CLAIM_LOCK_HOURS } from "../lib/constants";
import { formatLockDeadlineUtc } from "./display";

export const CLAIM_LABEL = "bounty-claimed";

export type ClaimNotifyInput = {
  owner: string;
  repo: string;
  issueNumber: number;
  installationId: bigint | number | string | null | undefined;
  hunterLabel: string;
  expiresAt: Date;
  hours?: number;
};

export type ClaimNotifyResult = {
  attempted: boolean;
  commentOk: boolean;
  labelOk: boolean;
  reason?: string;
};

/**
 * Best-effort issue comment + label when a hunter takes the 72h lock.
 * Missing App token or GitHub errors must not block the lock write.
 */
export async function notifyIssueClaimed(
  input: ClaimNotifyInput,
  opts: { http?: GitHubHttp; jwt?: string } = {},
): Promise<ClaimNotifyResult> {
  if (input.installationId == null || input.installationId === "") {
    return { attempted: false, commentOk: false, labelOk: false, reason: "no_installation" };
  }

  const hours = input.hours ?? CLAIM_LOCK_HOURS;
  const body = [
    `**GitHub Bounties** — ${input.hunterLabel} claimed an exclusive ${hours}h coordination lock`,
    `(until ${formatLockDeadlineUtc(input.expiresAt)}).`,
    "",
    "This lock does **not** move money. Merge is still truth: the winner is the author of the",
    "merged pull request that closes this funded issue.",
  ].join("\n");

  try {
    const comment = await createIssueComment({
      owner: input.owner,
      repo: input.repo,
      issueNumber: input.issueNumber,
      body,
      installationId: input.installationId,
      http: opts.http,
      jwt: opts.jwt,
    });
    const label = await addIssueLabels({
      owner: input.owner,
      repo: input.repo,
      issueNumber: input.issueNumber,
      labels: [CLAIM_LABEL],
      installationId: input.installationId,
      http: opts.http,
      jwt: opts.jwt,
    });
    return {
      attempted: true,
      commentOk: comment.ok,
      labelOk: label.ok,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "github_notify_failed";
    return { attempted: true, commentOk: false, labelOk: false, reason };
  }
}
