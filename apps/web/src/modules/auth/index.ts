/**
 * Auth module — V1-2 Google Sign-In via Auth.js (NextAuth v5) Google provider.
 * App identity is Google (`users.google_sub`). GitHub App install is V1-3.
 */
export const authModule = {
  name: "auth" as const,
  wired: true,
  nextTicket: "V1-3",
  notes: "Auth.js Google provider. Session cookie + users.google_sub upsert. Not GitHub user OAuth.",
};

export type AuthModule = typeof authModule;
