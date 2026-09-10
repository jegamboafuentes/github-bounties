/**
 * Coinbase Business hosted checkout inbound path — DISABLED (ADR 0001).
 *
 * Open Q: `settlement.feeAmount` may skim a merchant fee, so checkout
 * COMPLETED / net proceeds may be < face F. Do not treat hosted checkout as
 * an escrow hold. Prefer API / server-wallet fund lock (x402 `exact` or
 * direct USDC to `gb-escrow`). Re-enable only after net proceeds == face
 * is confirmed on a sandbox checkout.
 */
export const HOSTED_CHECKOUT_ENABLED = false;

export const HOSTED_CHECKOUT_BLOCKER =
  "Hosted Coinbase Business checkout is DISABLED until ADR 0001 open Q is resolved: settlement.feeAmount / net proceeds may be less than face F. Do not treat checkout COMPLETED as escrow hold. Prefer API/server-wallet fund lock (x402 exact or direct USDC to gb-escrow).";

export function hostedCheckoutStatus() {
  return {
    enabled: HOSTED_CHECKOUT_ENABLED,
    blocked: true,
    reason: HOSTED_CHECKOUT_BLOCKER,
    adr: "docs/adr/0001-cdp-x402-wallets.md",
    openQuestion: "settlement.feeAmount / netAmount < face",
  } as const;
}
