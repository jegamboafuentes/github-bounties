/**
 * Escrow module stub — V1-5 wires CDP / x402.
 * ADR 0001 is Accepted. Do not make live CDP calls from this ticket.
 */
export const escrowModule = {
  name: "escrow" as const,
  wired: false,
  nextTicket: "V1-5",
  notes: "Schema only. No CDP keys, no x402 facilitator calls, no mainnet USDC.",
};

export type EscrowModule = typeof escrowModule;
