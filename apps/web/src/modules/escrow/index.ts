/**
 * Escrow module — V1-5 CDP / x402 server-wallet lock, 2% fee at settlement.
 * Hosted checkout remains DISABLED (ADR 0001 settlement.feeAmount open Q).
 */
export const escrowModule = {
  name: "escrow" as const,
  wired: true,
  nextTicket: "V1-6",
  notes:
    "gb-escrow lock → settle hunter net of 2% + gb-fee, or refund face. Mock rail documents missing CDP_*. Hosted checkout disabled.",
};

export type EscrowModule = typeof escrowModule;
