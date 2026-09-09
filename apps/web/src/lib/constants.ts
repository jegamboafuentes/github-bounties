/** Product locks for GitHub Bounties (not Lightning Bounties / LB1). */

export const PRODUCT_NAME = "GitHub Bounties";

/** Platform fee: 2% of bounty face. ADR 0001. */
export const FEE_BPS = 200;

/** Exclusive coordination lock. Does not move USDC. */
export const CLAIM_LOCK_HOURS = 72;

export const DEFAULT_CURRENCY = "USDC";

/** V1 is Base-only. Sandbox uses Base Sepolia at the rail layer (V1-5). */
export const DEFAULT_CHAIN = "base";

export const USDC_DECIMALS = 6;
