/**
 * Claims module stub — V1 winner is the merged PR author that closes funded #N.
 * Claim-lock (72h exclusive) coordinates work; merge is truth.
 */
export const claimsModule = {
  name: "claims" as const,
  wired: false,
  nextTicket: "V1-6",
  notes: "Schema: claim_locks + claims (eligible|paid|rejected|disputed).",
};

export type ClaimsModule = typeof claimsModule;
