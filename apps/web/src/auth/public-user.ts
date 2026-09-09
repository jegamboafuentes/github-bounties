import type { UserRow } from "./users";

/** JSON shape for /api/me and the settings page. */
export type PublicUser = {
  id: string;
  google_sub: string;
  email: string;
  display_name: string;
};

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    google_sub: row.googleSub,
    email: row.email,
    display_name: row.displayName,
  };
}

export function unauthorizedJson(): Response {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export function jsonMe(user: PublicUser | null): Response {
  if (!user) return unauthorizedJson();
  return Response.json({ ok: true, user }, { headers: { "cache-control": "no-store" } });
}

export function githubConnectStubBody() {
  return {
    ok: false,
    stub: true,
    wired: false,
    error: "not_implemented",
    ticket: "V1-3",
    message:
      "GitHub App install is not wired yet. Product login is Google; the GitHub App is repo authority in V1-3.",
  };
}

export function githubConnectStubResponse(user: PublicUser | null): Response {
  if (!user) return unauthorizedJson();
  return Response.json(githubConnectStubBody(), {
    status: 501,
    headers: { "cache-control": "no-store" },
  });
}
