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
