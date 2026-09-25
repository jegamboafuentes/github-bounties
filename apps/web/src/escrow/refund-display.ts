/**
 * Every confirmed refund hash for the bounty page, oldest contribution first.
 * The escrow row stores only the last leg, so it is appended when it is not
 * already one of the contribution hashes.
 */
export function refundLegTxHashes(input: {
  contributionRefundTxHashes: readonly (string | null | undefined)[];
  escrowRefundTxHash?: string | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (hash: string | null | undefined) => {
    const trimmed = hash?.trim() ?? "";
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };
  for (const hash of input.contributionRefundTxHashes) push(hash);
  push(input.escrowRefundTxHash);
  return out;
}
