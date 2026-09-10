import type { UserRow } from "./users";

/** JSON shape for /api/me and the settings page. */
export type PublicUser = {
  id: string;
  google_sub: string;
  email: string;
  display_name: string;
  wallet_address: string | null;
};

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    google_sub: row.googleSub,
    email: row.email,
    display_name: row.displayName,
    wallet_address: row.walletAddress,
  };
}

export function unauthorizedJson(): Response {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export function jsonMe(user: PublicUser | null): Response {
  if (!user) return unauthorizedJson();
  return Response.json({ ok: true, user }, { headers: { "cache-control": "no-store" } });
}
