import { apiErrorResponse } from "./errors";

/** RFC 9110 Allow value for the read-only `/api/v1` routes. */
export const PUBLIC_READ_ALLOW = "GET, OPTIONS";

/**
 * POST, PUT, PATCH, and DELETE on `/api/v1/*`.
 * Same JSON error envelope as the other V4-1 failures, plus Allow.
 */
export function methodNotAllowed(): Response {
  return apiErrorResponse(
    "method_not_allowed",
    "Only GET and OPTIONS are allowed.",
    null,
    { Allow: PUBLIC_READ_ALLOW },
  );
}
