import { PUBLIC_API_CORS_HEADERS } from "./cors";
import { apiErrorResponse } from "./errors";

/** RFC 9110 Allow value for the read-only `/api/v1` routes. */
export const PUBLIC_READ_ALLOW = "GET, OPTIONS";

/**
 * POST, PUT, PATCH, and DELETE on `/api/v1/*`.
 * Same JSON error envelope as the other V4-1 failures, plus Allow.
 */
export function methodNotAllowed(allow: string = PUBLIC_READ_ALLOW): Response {
  const readOnly = allow === PUBLIC_READ_ALLOW;
  return apiErrorResponse(
    "method_not_allowed",
    readOnly ? "Only GET and OPTIONS are allowed." : `Only ${allow} are allowed.`,
    null,
    { Allow: allow, ...PUBLIC_API_CORS_HEADERS },
  );
}
