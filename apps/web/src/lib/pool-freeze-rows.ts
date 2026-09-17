/**
 * Map V2-0 `evaluatePoolEligibility` onto `pool_participants` freeze rows.
 *
 * Pure. No DB, no GitHub, no USDC movement. V2-2 persists these rows on
 * winning merge. Overflow / excluded / late hunters are not paid from the pool.
 */

import { CLAIM_SKIP } from "../webhooks/outcome";
import { splitPostFeePool } from "./money";
import {
  evaluatePoolEligibility,
  isPoolPayableBountyStatus,
  sameActor,
  type PoolEligibilityInput,
  type PoolEligibilityResult,
  type PoolPullRequest,
  type PoolSkipped,
} from "./pool-eligibility";

export type FrozenParticipantRole =
  | "winner"
  | "pool"
  | "overflow"
  | "excluded_poster"
  | "excluded_bot";

export type FrozenParticipantDraft = {
  githubId: number;
  githubLogin: string;
  role: FrozenParticipantRole;
  qualifyingPrNumber: number | null;
  qualifyingPrCreatedAt: string | null;
  qualifyingPrUrl: string | null;
  commitSha: string | null;
  shareUsdc: string;
  skipReason: string | null;
};

export type FrozenSetDraft = {
  rows: FrozenParticipantDraft[];
  skipped: PoolSkipped[];
  eligibleCount: number;
  paidCount: number;
  winnerUsdc: string;
  eachUsdc: string | null;
};

function prUrl(pr: PoolPullRequest, repositoryFullName: string): string {
  return pr.htmlUrl ?? `https://github.com/${repositoryFullName}/pull/${pr.number}`;
}

function findPr(
  input: PoolEligibilityInput,
  number: number | undefined,
): PoolPullRequest | undefined {
  if (number == null) return undefined;
  return input.pullRequests.find((pr) => pr.number === number);
}

export function ownCommitShaAtFreeze(pr: PoolPullRequest): string | null {
  for (const commit of pr.commitsAtFreeze ?? []) {
    const authors = commit.authors ?? [];
    if (
      authors.some((author) => {
        if (author.githubId != null && author.githubId === pr.authorId) return true;
        return author.login.toLowerCase() === pr.authorLogin.toLowerCase();
      })
    ) {
      return commit.sha;
    }
  }
  return null;
}

function skipReasonForLinked(
  role: FrozenParticipantRole,
  linked: boolean,
  extra?: string | null,
): string | null {
  if (role === "overflow") return extra ?? "overflow";
  if (role === "excluded_poster") return "poster";
  if (role === "excluded_bot") return "bot";
  if (!linked) return CLAIM_SKIP.hunterNotLinked;
  return extra ?? null;
}

/**
 * Freeze-time roster rows from the V2-0 predicate. Late / no-commit /
 * cross-repo hunters stay in `skipped` and are **not** `role=pool`.
 */
export function frozenParticipantsFromEligibility(
  input: PoolEligibilityInput,
  faceUsdc: string,
  result: PoolEligibilityResult = evaluatePoolEligibility(input),
  linkedGithubIds: ReadonlySet<number> = new Set(),
): FrozenSetDraft {
  if (!isPoolPayableBountyStatus(input.bounty.status)) {
    return {
      rows: [],
      skipped: result.skipped,
      eligibleCount: 0,
      paidCount: 0,
      winnerUsdc: "0",
      eachUsdc: null,
    };
  }

  const split = splitPostFeePool(faceUsdc, result.eligibleCount);
  const repo = input.bounty.repositoryFullName;
  const byGithubId = new Map<number, FrozenParticipantDraft>();

  const winningPr =
    findPr(input, input.winningMerge.prNumber) ?? input.pullRequests[0];
  const winnerLinked = linkedGithubIds.has(input.winner.githubId);
  byGithubId.set(input.winner.githubId, {
    githubId: input.winner.githubId,
    githubLogin: input.winner.login,
    role: "winner",
    qualifyingPrNumber: input.winningMerge.prNumber,
    qualifyingPrCreatedAt: winningPr?.createdAt ?? input.winningMerge.mergedAt,
    qualifyingPrUrl: winningPr ? prUrl(winningPr, repo) : null,
    commitSha: winningPr ? ownCommitShaAtFreeze(winningPr) : null,
    shareUsdc: split.winnerUsdc,
    skipReason: skipReasonForLinked("winner", winnerLinked),
  });

  for (const member of [...result.paid, ...result.overflow]) {
    if (byGithubId.has(member.githubId)) continue;
    const pr = findPr(input, member.qualifyingPrNumber);
    const linked = linkedGithubIds.has(member.githubId);
    byGithubId.set(member.githubId, {
      githubId: member.githubId,
      githubLogin: member.login,
      role: member.role,
      qualifyingPrNumber: member.qualifyingPrNumber,
      qualifyingPrCreatedAt: member.qualifyingPrCreatedAt,
      qualifyingPrUrl: pr ? prUrl(pr, repo) : null,
      commitSha: pr ? ownCommitShaAtFreeze(pr) : null,
      shareUsdc: member.role === "pool" ? (split.eachUsdc ?? "0") : "0",
      skipReason: skipReasonForLinked(member.role, linked),
    });
  }

  for (const skipped of result.skipped) {
    if (byGithubId.has(skipped.githubId)) continue;
    if (skipped.reason === "poster") {
      const pr = findPr(input, skipped.prNumber);
      byGithubId.set(skipped.githubId, {
        githubId: skipped.githubId,
        githubLogin: skipped.login,
        role: "excluded_poster",
        qualifyingPrNumber: skipped.prNumber ?? null,
        qualifyingPrCreatedAt: pr?.createdAt ?? null,
        qualifyingPrUrl: pr ? prUrl(pr, repo) : null,
        commitSha: pr ? ownCommitShaAtFreeze(pr) : null,
        shareUsdc: "0",
        skipReason: "poster",
      });
      continue;
    }
    if (skipped.reason === "bot") {
      const pr = findPr(input, skipped.prNumber);
      byGithubId.set(skipped.githubId, {
        githubId: skipped.githubId,
        githubLogin: skipped.login,
        role: "excluded_bot",
        qualifyingPrNumber: skipped.prNumber ?? null,
        qualifyingPrCreatedAt: pr?.createdAt ?? null,
        qualifyingPrUrl: pr ? prUrl(pr, repo) : null,
        commitSha: pr ? ownCommitShaAtFreeze(pr) : null,
        shareUsdc: "0",
        skipReason: "bot",
      });
    }
  }

  return {
    rows: [...byGithubId.values()],
    skipped: result.skipped,
    eligibleCount: result.eligibleCount,
    paidCount: result.paidCount,
    winnerUsdc: split.winnerUsdc,
    eachUsdc: split.eachUsdc,
  };
}

export function isPosterOrWinner(
  input: Pick<PoolEligibilityInput, "winner" | "bounty">,
  candidate: { login: string; githubId: number },
): "winner" | "poster" | null {
  if (sameActor(input.winner, candidate)) return "winner";
  if (sameActor(input.bounty.poster, candidate)) return "poster";
  return null;
}
