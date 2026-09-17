/**
 * V2-0 pool eligibility predicate (ADR 0003). Pure. No DB, no GitHub API,
 * no webhook writer. V2-2 will feed freeze-time snapshots into this.
 *
 * Eligible = non-winner, non-poster; opened ≥1 PR that references funded `#N`
 * **before** the winning merge; that PR has ≥1 commit by them at freeze.
 *
 * Paid set: max 10, earliest first-qualifying-PR `created_at`, then
 * `pr_number ASC`, then `github_id ASC`.
 */

import { POOL_MAX_PAID } from "./constants";
import { pullRequestReferencesIssue } from "./issue-refs";

/** V1 payable bounty rows at merge. `pending_fund` yields no pool. */
export const POOL_PAYABLE_BOUNTY_STATUSES = ["funded", "claim_locked"] as const;

export type PoolSkipReason =
  | "not_funded"
  | "winner"
  | "poster"
  | "bot"
  | "cross_repo"
  | "late_pr"
  | "no_reference"
  | "no_own_commit";

export type PoolCommitAuthor = {
  login: string;
  githubId?: number;
};

export type PoolPullRequest = {
  number: number;
  title: string;
  body: string;
  authorLogin: string;
  authorId: number;
  /** GitHub `user.type`. Bots are never pool-eligible. */
  authorType?: string;
  createdAt: string;
  draft?: boolean;
  merged?: boolean;
  closed?: boolean;
  /** Base repo. Must equal the bounty repo. Forks count when base is the bounty repo. */
  baseRepositoryFullName: string;
  headRepositoryFullName?: string;
  /** Commit authors on the PR **at freeze** (winning merge). No reflog. */
  commitAuthorsAtFreeze: PoolCommitAuthor[];
  commitMessages?: string[];
  closingIssueNumbers?: number[];
};

export type PoolActor = {
  login: string;
  githubId: number;
};

export type PoolEligibilityInput = {
  bounty: {
    issueNumber: number;
    repositoryFullName: string;
    status: string;
    poster: PoolActor;
  };
  winner: PoolActor;
  winningMerge: {
    prNumber: number;
    mergedAt: string;
  };
  pullRequests: PoolPullRequest[];
};

export type PoolMember = {
  githubId: number;
  login: string;
  qualifyingPrNumber: number;
  qualifyingPrCreatedAt: string;
  role: "pool" | "overflow";
};

export type PoolSkipped = {
  githubId: number;
  login: string;
  prNumber?: number;
  reason: PoolSkipReason;
};

export type PoolEligibilityResult = {
  paid: PoolMember[];
  overflow: PoolMember[];
  skipped: PoolSkipped[];
  eligibleCount: number;
  paidCount: number;
};

export function isPoolPayableBountyStatus(status: string): boolean {
  return (POOL_PAYABLE_BOUNTY_STATUSES as readonly string[]).includes(status);
}

export function isBotAccount(pr: Pick<PoolPullRequest, "authorType" | "authorLogin">): boolean {
  const type = (pr.authorType ?? "User").toLowerCase();
  if (type === "bot") return true;
  return pr.authorLogin.toLowerCase().includes("[bot]");
}

export function sameActor(
  actor: PoolActor,
  candidate: { login: string; githubId: number },
): boolean {
  if (candidate.githubId === actor.githubId) return true;
  return candidate.login.toLowerCase() === actor.login.toLowerCase();
}

export function hasOwnCommitAtFreeze(pr: PoolPullRequest): boolean {
  return pr.commitAuthorsAtFreeze.some((author) => {
    if (author.githubId != null && author.githubId === pr.authorId) return true;
    return author.login.toLowerCase() === pr.authorLogin.toLowerCase();
  });
}

/**
 * Sort: created_at ASC, pr_number ASC, github_id ASC (ADR 0003 tie-break).
 * Deterministic; no lottery.
 */
export function comparePoolRank(
  a: { qualifyingPrCreatedAt: string; qualifyingPrNumber: number; githubId: number },
  b: { qualifyingPrCreatedAt: string; qualifyingPrNumber: number; githubId: number },
): number {
  const ta = Date.parse(a.qualifyingPrCreatedAt);
  const tb = Date.parse(b.qualifyingPrCreatedAt);
  if (ta !== tb) return ta - tb;
  if (a.qualifyingPrNumber !== b.qualifyingPrNumber) {
    return a.qualifyingPrNumber - b.qualifyingPrNumber;
  }
  return a.githubId - b.githubId;
}

export function capPaidPool<T extends { qualifyingPrCreatedAt: string; qualifyingPrNumber: number; githubId: number }>(
  eligible: T[],
  maxPaid: number = POOL_MAX_PAID,
): { paid: T[]; overflow: T[] } {
  const ranked = [...eligible].sort(comparePoolRank);
  return {
    paid: ranked.slice(0, maxPaid),
    overflow: ranked.slice(maxPaid),
  };
}

function skipReasonForPr(
  pr: PoolPullRequest,
  input: PoolEligibilityInput,
): PoolSkipReason | null {
  const bountyRepo = input.bounty.repositoryFullName.toLowerCase();
  const candidate = { login: pr.authorLogin, githubId: pr.authorId };

  if (sameActor(input.winner, candidate)) return "winner";
  if (sameActor(input.bounty.poster, candidate)) return "poster";
  if (isBotAccount(pr)) return "bot";
  if (pr.baseRepositoryFullName.toLowerCase() !== bountyRepo) return "cross_repo";

  const created = Date.parse(pr.createdAt);
  const merged = Date.parse(input.winningMerge.mergedAt);
  if (!(created < merged)) return "late_pr";

  if (
    !pullRequestReferencesIssue(pr, input.bounty.issueNumber, input.bounty.repositoryFullName)
  ) {
    return "no_reference";
  }

  if (!hasOwnCommitAtFreeze(pr)) return "no_own_commit";
  return null;
}

/**
 * Freeze-time pool set `E` from a PR snapshot. One hunter → earliest qualifying
 * PR (`min(created_at)`, then `pr_number`). Cap 10 for the paid set.
 */
export function evaluatePoolEligibility(
  input: PoolEligibilityInput,
  maxPaid: number = POOL_MAX_PAID,
): PoolEligibilityResult {
  const skipped: PoolSkipped[] = [];

  if (!isPoolPayableBountyStatus(input.bounty.status)) {
    for (const pr of input.pullRequests) {
      skipped.push({
        githubId: pr.authorId,
        login: pr.authorLogin,
        prNumber: pr.number,
        reason: "not_funded",
      });
    }
    return {
      paid: [],
      overflow: [],
      skipped,
      eligibleCount: 0,
      paidCount: 0,
    };
  }

  const bestByHunter = new Map<
    number,
    {
      githubId: number;
      login: string;
      qualifyingPrNumber: number;
      qualifyingPrCreatedAt: string;
    }
  >();

  for (const pr of input.pullRequests) {
    const reason = skipReasonForPr(pr, input);
    if (reason) {
      skipped.push({
        githubId: pr.authorId,
        login: pr.authorLogin,
        prNumber: pr.number,
        reason,
      });
      continue;
    }
    const prev = bestByHunter.get(pr.authorId);
    const next = {
      githubId: pr.authorId,
      login: pr.authorLogin,
      qualifyingPrNumber: pr.number,
      qualifyingPrCreatedAt: pr.createdAt,
    };
    if (!prev || comparePoolRank(next, prev) < 0) {
      bestByHunter.set(pr.authorId, next);
    }
  }

  const eligible = [...bestByHunter.values()];
  const { paid, overflow } = capPaidPool(eligible, maxPaid);

  return {
    paid: paid.map((row) => ({ ...row, role: "pool" as const })),
    overflow: overflow.map((row) => ({ ...row, role: "overflow" as const })),
    skipped,
    eligibleCount: eligible.length,
    paidCount: paid.length,
  };
}
