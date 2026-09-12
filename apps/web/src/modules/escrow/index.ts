/**
 * Escrow module — V1-5 CDP / x402 server-wallet lock, 2% fee at settlement.
 * Hosted checkout remains DISABLED (ADR 0001 settlement.feeAmount open Q).
 */
export const escrowModule = {
  name: "escrow" as const,
  wired: true,
  nextTicket: "V2",
  notes:
    "gb-escrow lock → hunter claim release (net of 2% + gb-fee) or refund face. DEV inbound is x402 exact to gb-escrow (no paste-hash). Mock rail documents missing CDP_*. Hosted checkout disabled.",
};

export type EscrowModule = typeof escrowModule;
