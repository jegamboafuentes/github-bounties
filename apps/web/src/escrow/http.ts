import { EscrowError, type EscrowErrorCode } from "./errors";

/**
 * Lock / settle / refund / claim money routes.
 * Client and rail failures are 4xx with `{ error, message }` — never 200.
 */
export function httpStatusForEscrowCode(code: EscrowErrorCode): number {
  if (code === "unauthorized") return 401;
  if (code === "not_poster" || code === "not_settler") return 403;
  if (code === "bounty_not_found") return 404;
  return 400;
}

export type EscrowErrorJson = {
  ok: false;
  error: string;
  message: string;
  fail_code: string;
  fail_reason: string;
  missing?: string[];
  details?: Record<string, string>;
};

export function escrowErrorJson(err: EscrowError): EscrowErrorJson {
  return {
    ok: false,
    error: err.code,
    message: err.message,
    fail_code: err.code,
    fail_reason: err.message,
    ...(err.missing ? { missing: err.missing } : {}),
    ...(err.details ? { details: err.details } : {}),
  };
}

export function jsonForUnknown(message: string) {
  return {
    ok: false as const,
    error: "unknown",
    message,
    fail_code: "unknown",
    fail_reason: message,
  };
}

