export type RefundSummaryLeg = {
  destination: string | null;
  txHash: string | null;
};

/**
 * Single-payer refunds keep top-level `destination` and `refundTxHash` for
 * older clients, and both describe that one leg.
 * A multi-leg refund leaves both null. `legs` is the source of truth, so the
 * summary cannot pair leg 1's payer with leg 2's transaction.
 * An empty `legs` array (already-terminal replay) keeps the caller-supplied pair.
 */
export function refundApiSummary(input: {
  legs: readonly RefundSummaryLeg[];
  destination: string | null;
  refundTxHash: string | null;
}): { destination: string | null; refundTxHash: string | null } {
  if (input.legs.length > 1) {
    return { destination: null, refundTxHash: null };
  }
  const only = input.legs[0];
  if (only) {
    return {
      destination: only.destination ?? input.destination,
      refundTxHash: only.txHash ?? input.refundTxHash,
    };
  }
  return { destination: input.destination, refundTxHash: input.refundTxHash };
}
