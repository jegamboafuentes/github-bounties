/** Address a claim leg was paid to, or the saved wallet it will be paid to. */
export function claimLegDestination(
  paidTo: string | null | undefined,
  savedWallet: string | null | undefined,
): string | null {
  const paid = paidTo?.trim() ?? "";
  if (paid) return paid;
  const saved = savedWallet?.trim() ?? "";
  return saved || null;
}
