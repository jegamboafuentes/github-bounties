/**
 * One UUID check for public bounty ids: pages, website routes, REST, admin, and MCP.
 * RFC 4122 so a bad id never reaches Postgres (which would throw `Failed query: select …`).
 */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Website `/api/bounties/{id}/*` body for a malformed id. */
export function platformNotFoundBody() {
  return { ok: false as const, error: "not_found" as const, message: "Not found." };
}

export function platformNotFoundResponse(): Response {
  return Response.json(platformNotFoundBody(), {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}
