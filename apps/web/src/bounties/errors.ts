export type BountyErrorCode =
  | "unauthorized"
  | "invalid_issue_url"
  | "invalid_amount"
  | "repo_not_connected"
  | "bounty_exists"
  | "bounty_not_found"
  | "not_poster"
  | "not_claimant_or_poster"
  | "not_fundable"
  | "not_settleable"
  | "not_refundable"
  | "not_claimable"
  | "already_locked"
  | "lock_not_active";

export class BountyError extends Error {
  readonly code: BountyErrorCode;

  constructor(code: BountyErrorCode, message: string) {
    super(message);
    this.name = "BountyError";
    this.code = code;
  }
}

export function isBountyError(err: unknown): err is BountyError {
  return err instanceof BountyError;
}
