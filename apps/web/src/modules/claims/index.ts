/**
 * Claims module — V1 winner is the merged PR author that closes funded #N.
 * Eligible hunter claims net-of-fee USDC to a BYO Base address (V1-6).
 */
export const claimsModule = {
  name: "claims" as const,
  wired: true,
  nextTicket: "V2",
  notes:
    "Merge marks Claim eligible. Winner claims winner share + fee only. Frozen pool members claim their own POOL_PAYOUT later.",
};

export type ClaimsModule = typeof claimsModule;
