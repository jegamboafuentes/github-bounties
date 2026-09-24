/**
 * Client IP for the per-instance rate limit.
 *
 * Cloud Run appends the connecting client to `X-Forwarded-For`, so the last
 * hop is the address Cloud Run observed. A caller-supplied prefix is ignored.
 */
export function clientIpFromForwardedFor(value: string | null | undefined): string {
  if (!value) return "unknown";
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? "unknown";
}

export function clientIpFromRequest(request: { headers: { get(name: string): string | null } }): string {
  return clientIpFromForwardedFor(request.headers.get("x-forwarded-for"));
}
