import { FEE_BPS, POOL_BPS_OF_POST_FEE } from "../lib/constants";

/** Per-bounty stamp. The constant is only the column default for a row that predates the stamp. */
export function bountyFeeBps(feeBps: number | null | undefined): number {
  return feeBps ?? FEE_BPS;
}

/** Per-bounty stamp. 1500 means 15% of post-fee, not of face. */
export function bountyPoolBps(poolBps: number | null | undefined): number {
  return poolBps ?? POOL_BPS_OF_POST_FEE;
}
