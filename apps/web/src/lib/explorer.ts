const TX_RE = /^0x[0-9a-fA-F]{64}$/;

/** Public Base explorer link. Mock and non-transaction ids stay unlinked. */
export function baseTxExplorerUrl(txHash: string, mainnet: boolean): string | null {
  const hash = txHash.trim();
  if (!TX_RE.test(hash)) return null;
  const host = mainnet ? "https://basescan.org" : "https://sepolia.basescan.org";
  return `${host}/tx/${hash}`;
}
