import type { ClaimWriteResult } from "./types";

export const CLAIM_SKIP = {
  repoUnknown: "repo_unknown",
  repoNotConnected: "repo_not_connected",
  noFundedBounty: "no_funded_bounty",
  hunterNotLinked: "hunter_not_linked",
  prNumberMissing: "pr_number_missing",
  claimTerminal: "claim_terminal",
  noClaimWritten: "no_claim_written",
} as const;

export function hasSuccessfulClaimWrite(
  results?: ClaimWriteResult[] | null,
): boolean {
  return Boolean(results?.some((row) => Boolean(row.claimId)));
}

export function claimSkipReasons(
  results?: ClaimWriteResult[] | null,
): string[] {
  return [
    ...new Set(
      (results ?? [])
        .map((row) => row.skip)
        .filter((skip): skip is string => Boolean(skip)),
    ),
  ];
}

/** Redeliver when merge was eligible but no Claim row was written. */
export function shouldRetryClaimWrites(existing: {
  eligible?: boolean | null;
  claimResults?: ClaimWriteResult[] | null;
}): boolean {
  return existing.eligible === true && !hasSuccessfulClaimWrite(existing.claimResults);
}
