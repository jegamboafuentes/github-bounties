/**
 * Webhooks module — V1-3 GitHub App HMAC + eligibility + eligible Claim rows.
 * V0-B predicate/tests remain at repo-root `src/` + `tests/` for CI.
 */
export const webhooksModule = {
  name: "webhooks" as const,
  wired: true,
  nextTicket: "V1-4",
  notes:
    "POST /webhooks/github verifies HMAC, is idempotent by delivery id, and marks Claim eligible on merge+close of funded #N.",
};

export type WebhooksModule = typeof webhooksModule;
