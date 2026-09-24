export type EscrowErrorCode =
  | "unauthorized"
  | "bounty_not_found"
  | "not_poster"
  | "not_settler"
  | "not_pool_member"
  | "not_fundable"
  | "not_settleable"
  | "not_refundable"
  | "missing_payout_address"
  | "invalid_payout_address"
  | "missing_funder_address"
  | "fund_hash_not_verified"
  | "fund_hash_reused"
  | "insufficient_bounty_funds"
  | "destination_mismatch"
  | "missing_cdp_env"
  | "mainnet_refused"
  | "inbound_unconfirmed"
  | "x402_payment_invalid"
  | "x402_verify_failed"
  | "x402_settle_failed"
  | "x402_settle_mismatch"
  | "x402_facilitator_unavailable"
  | "hosted_checkout_disabled"
  | "cdp_sdk_missing"
  | "rail_failed"
  | "illegal_transition";

export class EscrowError extends Error {
  readonly code: EscrowErrorCode;
  readonly missing?: string[];
  readonly details?: Record<string, string>;

  constructor(
    code: EscrowErrorCode,
    message: string,
    extras?: { missing?: string[]; details?: Record<string, string> },
  ) {
    super(message);
    this.name = "EscrowError";
    this.code = code;
    this.missing = extras?.missing;
    this.details = extras?.details;
  }
}

export function isEscrowError(err: unknown): err is EscrowError {
  return err instanceof EscrowError;
}
