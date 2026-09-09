/**
 * Webhooks module stub — V1-3 talks to the GitHub App.
 * V0-B HMAC + eligibility live under repo-root `src/` until this app hosts them.
 */
export const webhooksModule = {
  name: "webhooks" as const,
  wired: false,
  nextTicket: "V1-3",
  notes: "POST /webhooks/github is a stub here. V0-B spike remains the predicate reference.",
};

export type WebhooksModule = typeof webhooksModule;
