/**
 * Auth module stub — V1-2 wires Google Sign-In.
 * Product users sign in with Google (`users.google_sub`). Not implemented here.
 */
export const authModule = {
  name: "auth" as const,
  wired: false,
  nextTicket: "V1-2",
  notes: "Google Sign-In. Do not add GitHub user OAuth for product login.",
};

export type AuthModule = typeof authModule;
