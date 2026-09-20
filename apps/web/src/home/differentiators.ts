import { FEE_BPS, POOL_BPS_OF_POST_FEE, POOL_MAX_PAID } from "@/lib/constants";

/** Homepage compare copy. GitHub Bounties is not Lightning Bounties / LB1. */

export const NOT_LIGHTNING_BOUNTIES =
  "This is not Lightning Bounties, LB1, or “Lightning Bounties 2”.";

export const HOMEPAGE_DIFFERENTIATORS = [
  {
    id: "pool",
    title: "Fair hunter economics",
    body: `V2 pool: ${FEE_BPS / 100}% fee, then 85% to the winning merge author and ${POOL_BPS_OF_POST_FEE / 100}% of post-fee split equally among up to ${POOL_MAX_PAID} eligible hunters. Empty pool still pays the winner 98% of face.`,
  },
  {
    id: "usdc",
    title: "USDC on Base, not Lightning",
    body: "Settlement is USDC via CDP escrow + x402 — not Lightning Network invoices or LN balances.",
  },
  {
    id: "fee",
    title: `${FEE_BPS / 100}% platform fee`,
    body: `fee_bps = ${FEE_BPS}, taken at settlement only. Face locks in gb-escrow; ${FEE_BPS / 100}% goes to gb-fee. No hidden skim.`,
  },
] as const;
