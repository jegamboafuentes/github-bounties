import { ZodError } from "zod";

/** Error codes the V4-1 read API and MCP tools return. */
export const PUBLIC_API_ERROR_CODES = [
  "validation_failed",
  "not_found",
  "method_not_allowed",
  "rate_limited",
  "internal",
] as const;

/**
 * V4-2 codes. Domain codes from bounty and escrow (for example `bounty_exists`,
 * `not_poster`) are not in this list. They pass through unchanged.
 */
export const API_V2_ERROR_CODES = [
  "unauthorized",
  "key_revoked",
  "forbidden_scope",
  "conflict",
  "payment_required",
  "spend_cap_exceeded",
  "idempotency_key_required",
  "idempotency_conflict",
  "wallet_not_set",
  "github_not_linked",
  "already_cancelled",
] as const;

export const API_ERROR_CODES = [...PUBLIC_API_ERROR_CODES, ...API_V2_ERROR_CODES] as const;

export type PublicApiErrorCode = (typeof PUBLIC_API_ERROR_CODES)[number];
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type PublicApiErrorBody = {
  error: {
    code: string;
    message: string;
    details: unknown;
  };
};

const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  validation_failed: 400,
  not_found: 404,
  method_not_allowed: 405,
  rate_limited: 429,
  internal: 500,
  unauthorized: 401,
  key_revoked: 401,
  forbidden_scope: 403,
  conflict: 409,
  payment_required: 402,
  spend_cap_exceeded: 403,
  idempotency_key_required: 400,
  idempotency_conflict: 409,
  wallet_not_set: 403,
  github_not_linked: 403,
  already_cancelled: 409,
};

export class PublicApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, details: unknown = null, status?: number) {
    super(message);
    this.name = "PublicApiError";
    this.code = code;
    this.status = status ?? STATUS_FOR_CODE[code as ApiErrorCode] ?? 400;
    this.details = details;
  }
}

export function publicApiErrorBody(
  code: string,
  message: string,
  details: unknown = null,
): PublicApiErrorBody {
  return { error: { code, message, details } };
}

export function zodErrorDetails(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export function apiErrorResponse(
  code: string,
  message: string,
  details: unknown = null,
  extraHeaders?: Record<string, string>,
  status?: number,
): Response {
  return Response.json(publicApiErrorBody(code, message, details), {
    status: status ?? STATUS_FOR_CODE[code as ApiErrorCode] ?? 400,
    headers: {
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

export function errorResponseFor(err: PublicApiError, extraHeaders?: Record<string, string>): Response {
  return apiErrorResponse(err.code, err.message, err.details, extraHeaders, err.status);
}
