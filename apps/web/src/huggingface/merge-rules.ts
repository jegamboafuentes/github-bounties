/**
 * Winner-only Hugging Face merge rules. Shared by the webhook and the poller.
 * A failing rule does not write an eligible claim. `merger_review_required`
 * writes a disputed claim and does not auto-pay.
 */

export const HF_MERGE_SKIP = {
  notAPullRequest: "not_a_pull_request",
  notMerged: "not_merged",
  missingMergeCommit: "missing_merge_commit",
  wrongBase: "wrong_base",
  prBeforeBounty: "pr_before_bounty",
  authorMissing: "author_missing",
  selfMerge: "self_merge",
  insider: "insider",
  mergerReviewRequired: "merger_review_required",
  noSubmission: "no_submission",
  discussionNotFound: "discussion_not_found",
} as const;

export type HfIdentity = {
  login: string | null;
  id: string | null;
};

export type HfMergerFacts = HfIdentity & {
  isOwner: boolean;
  isOrgMember: boolean;
};

export type HfMergeFacts = {
  isPullRequest: boolean;
  status: string;
  mergeCommitId: string | null;
  baseRef: string | null;
  defaultBranch: string;
  createdAt: Date | null;
  bountyCreatedAt: Date;
  author: HfIdentity;
  authorIsOrgMember: boolean;
  orgMember: boolean;
  merger: HfMergerFacts | null;
  repoOwner: string;
  blocked: readonly HfIdentity[];
};

export type HfMergeDecision =
  | { kind: "deny"; skip: string }
  | { kind: "review"; skip: typeof HF_MERGE_SKIP.mergerReviewRequired }
  | { kind: "eligible" };

export function namesMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = left?.trim().toLowerCase() ?? "";
  const b = right?.trim().toLowerCase() ?? "";
  return a.length > 0 && a === b;
}

export function idsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = left?.trim() ?? "";
  const b = right?.trim() ?? "";
  return a.length > 0 && a === b;
}

export function identitiesHit(left: HfIdentity, right: HfIdentity): boolean {
  return namesMatch(left.login, right.login) || idsMatch(left.id, right.id);
}

/** `refs/heads/main` and `main` are the same branch. */
export function branchName(ref: string | null | undefined): string {
  const trimmed = ref?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.replace(/^refs\/heads\//i, "").toLowerCase();
}

export function baseMatchesDefault(baseRef: string | null, defaultBranch: string): boolean {
  const base = branchName(baseRef);
  const expected = branchName(defaultBranch);
  return base.length > 0 && expected.length > 0 && base === expected;
}

/** Real-merge checks that do not need the default branch or the org roster. */
export function preliminaryMergeSkip(facts: {
  isPullRequest: boolean;
  status: string;
  mergeCommitId: string | null;
}): string | null {
  if (!facts.isPullRequest) return HF_MERGE_SKIP.notAPullRequest;
  if (facts.status.trim().toLowerCase() !== "merged") return HF_MERGE_SKIP.notMerged;
  if (!facts.mergeCommitId?.trim()) return HF_MERGE_SKIP.missingMergeCommit;
  return null;
}

export function evaluateHuggingFaceMerge(facts: HfMergeFacts): HfMergeDecision {
  const early = preliminaryMergeSkip(facts);
  if (early) return { kind: "deny", skip: early };
  if (!baseMatchesDefault(facts.baseRef, facts.defaultBranch)) {
    return { kind: "deny", skip: HF_MERGE_SKIP.wrongBase };
  }
  if (!facts.createdAt || facts.createdAt.getTime() <= facts.bountyCreatedAt.getTime()) {
    return { kind: "deny", skip: HF_MERGE_SKIP.prBeforeBounty };
  }
  if (!facts.author.login?.trim() && !facts.author.id?.trim()) {
    return { kind: "deny", skip: HF_MERGE_SKIP.authorMissing };
  }
  if (namesMatch(facts.author.login, facts.repoOwner)) {
    return { kind: "deny", skip: HF_MERGE_SKIP.selfMerge };
  }
  if (facts.merger && identitiesHit(facts.author, facts.merger)) {
    return { kind: "deny", skip: HF_MERGE_SKIP.selfMerge };
  }
  if (facts.blocked.some((identity) => identitiesHit(facts.author, identity))) {
    return { kind: "deny", skip: HF_MERGE_SKIP.selfMerge };
  }
  if (facts.authorIsOrgMember || facts.orgMember) {
    return { kind: "deny", skip: HF_MERGE_SKIP.insider };
  }
  if (!facts.merger || (!facts.merger.isOwner && !facts.merger.isOrgMember)) {
    return { kind: "review", skip: HF_MERGE_SKIP.mergerReviewRequired };
  }
  return { kind: "eligible" };
}
