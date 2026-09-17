/**
 * Webhooks module — V1-3 GitHub App HMAC + eligibility + eligible Claim rows.
 * V2-2 freezes `pool_participants` on winning merge (no USDC, no claim-lock).
 * V0-B predicate/tests remain at repo-root `src/` + `tests/` for CI.
 */
export const webhooksModule = {
  name: "webhooks" as const,
  wired: true,
  nextTicket: "V2-3",
  notes:
    "POST /webhooks/github verifies HMAC, is idempotent by delivery id, marks Claim eligible on merge+close of funded #N, and freezes pool E from a GitHub snapshot.",
};

export type WebhooksModule = typeof webhooksModule;
