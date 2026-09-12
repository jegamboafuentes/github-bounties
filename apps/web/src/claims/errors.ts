export type ClaimErrorCode =
  | "unauthorized"
  | "bounty_not_found"
  | "claim_not_found"
  | "not_hunter"
  | "not_eligible"
  | "hunter_not_linked"
  | "invalid_payout_address";

export class ClaimError extends Error {
  readonly code: ClaimErrorCode;

  constructor(code: ClaimErrorCode, message: string) {
    super(message);
    this.name = "ClaimError";
    this.code = code;
  }
}

export function isClaimError(err: unknown): err is ClaimError {
  return err instanceof ClaimError;
}

export const NOT_HUNTER_MESSAGE =
  "Only the eligible hunter (the merged pull request author tied to this claim) can claim this payout.";

export const NOT_ELIGIBLE_MESSAGE =
  "This bounty has no eligible claim. A merged pull request that closes the funded issue must mark you as the winner first.";
