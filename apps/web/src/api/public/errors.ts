import { ZodError } from "zod";

/** Error codes the V4-1 read API and MCP tools return. */
export const PUBLIC_API_ERROR_CODES = [
  "validation_failed",
  "not_found",
  "rate_limited",
  "internal",
] as const;

export type PublicApiErrorCode = (typeof PUBLIC_API_ERROR_CODES)[number];

export type PublicApiErrorBody = {
  error: {
    code: PublicApiErrorCode;
    message: string;
    details: unknown;
  };
};

const STATUS_FOR_CODE: Record<PublicApiErrorCode, number> = {
  validation_failed: 400,
  not_found: 404,
  rate_limited: 429,
  internal: 500,
};

export class PublicApiError extends Error {
  readonly code: PublicApiErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: PublicApiErrorCode, message: string, details: unknown = null, status?: number) {
    super(message);
    this.name = "PublicApiError";
    this.code = code;
    this.status = status ?? STATUS_FOR_CODE[code];
    this.details = details;
  }
}

export function publicApiErrorBody(
  code: PublicApiErrorCode,
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
  code: PublicApiErrorCode,
  message: string,
  details: unknown = null,
  extraHeaders?: Record<string, string>,
  status?: number,
): Response {
  return Response.json(publicApiErrorBody(code, message, details), {
    status: status ?? STATUS_FOR_CODE[code],
    headers: {
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

export function errorResponseFor(err: PublicApiError, extraHeaders?: Record<string, string>): Response {
  return apiErrorResponse(err.code, err.message, err.details, extraHeaders, err.status);
}
