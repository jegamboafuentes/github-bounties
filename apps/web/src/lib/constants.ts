/** Product locks for GitHub Bounties (not Lightning Bounties / LB1). */

export const PRODUCT_NAME = "GitHub Bounties";

/** Platform fee: 2% of bounty face. ADR 0001 / V1-5. Unchanged in V2. */
export const FEE_BPS = 200;

/**
 * Historical V1 exclusive coordination lock (hours). Does not move USDC.
 * V2-4 sunsets exclusive `claim_locks`: do not acquire new rows; drain
 * residuals on read. Use non-exclusive `work_signals`.
 */
export const CLAIM_LOCK_HOURS = 72;

/** Product flag: exclusive 72h claim-lock is retired (ADR 0003 / V2-4). */
export const CLAIM_LOCK_SUNSET = true;

/**
 * V2 pool share: **1500 bps of post-fee** (not of face). ADR 0003.
 * `pool_atomic = |E|=0 ? 0 : floor(post_fee × 1500 / 10_000)`.
 */
export const POOL_BPS_OF_POST_FEE = 1500;

/** Equal split among at most 10 earliest eligible hunters. ADR 0003. */
export const POOL_MAX_PAID = 10;

export const DEFAULT_CURRENCY = "USDC";

/** V1 is Base-only. Sandbox uses Base Sepolia at the rail layer (V1-5). */
export const DEFAULT_CHAIN = "base";

export const USDC_DECIMALS = 6;

/** CDP pooled server-wallet names (ADR 0001). 2–36 chars, [A-Za-z0-9-]. */
export const CDP_ESCROW_ACCOUNT_NAME = "gb-escrow";
export const CDP_FEE_ACCOUNT_NAME = "gb-fee";

/** Default rail. Live calls refuse mainnet unless explicitly allowed. */
export const CDP_DEFAULT_NETWORK = "base-sepolia";

export const BASE_SEPOLIA_CAIP2 = "eip155:84532";
export const BASE_MAINNET_CAIP2 = "eip155:8453";

/** Circle test USDC on Base Sepolia (6 decimals). */
export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/** Native USDC on Base mainnet — refused unless CDP_ALLOW_MAINNET=1. */
export const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
