export type BountyErrorCode =
  | "unauthorized"
  | "invalid_issue_url"
  | "invalid_amount"
  | "repo_not_connected"
  | "issue_not_found"
  | "issue_inaccessible"
  | "issue_rate_limited"
  | "not_an_issue"
  | "issue_closed"
  | "github_unavailable"
  | "hf_disabled"
  | "hf_discussion_not_found"
  | "hf_not_a_discussion"
  | "hf_discussion_closed"
  | "hf_discussion_inaccessible"
  | "hf_rate_limited"
  | "hf_timeout"
  | "hf_unavailable"
  | "hf_not_linked"
  | "not_a_pull_request"
  | "repo_mismatch"
  | "author_mismatch"
  | "pr_closed"
  | "already_submitted"
  | "submission_not_found"
  | "bounty_not_open"
  | "bounty_paid"
  | "bounty_exists"
  | "bounty_not_found"
  | "not_poster"
  | "bounty_has_funds"
  | "bounty_not_editable"
  | "amount_unchanged"
  | "not_claimant_or_poster"
  | "not_fundable"
  | "not_settleable"
  | "not_refundable"
  | "not_claimable"
  | "already_locked"
  | "lock_not_active"
  | "lock_sunset";

export class BountyError extends Error {
  readonly code: BountyErrorCode;
  readonly details: Record<string, unknown> | null;
  /** Overrides the domain status map. Deleted bounties on submissions use 410. */
  readonly httpStatus: number | null;

  constructor(
    code: BountyErrorCode,
    message: string,
    details: Record<string, unknown> | null = null,
    httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "BountyError";
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
  }
}

export function isBountyError(err: unknown): err is BountyError {
  return err instanceof BountyError;
}
