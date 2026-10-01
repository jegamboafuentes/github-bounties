import { redactDatabaseText, redactPublicValue } from "../http/redact-error";
import { EscrowError, type EscrowErrorCode } from "./errors";

/**
 * Lock / settle / refund / claim money routes.
 * Client and rail failures are 4xx with `{ error, message }` — never 200.
 */
export function httpStatusForEscrowCode(code: EscrowErrorCode): number {
  if (code === "unauthorized") return 401;
  if (code === "not_poster" || code === "not_settler" || code === "not_pool_member") return 403;
  if (code === "bounty_not_found") return 404;
  if (code === "insufficient_bounty_funds") return 409;
  return 400;
}

export function httpStatusForEscrowError(err: EscrowError): number {
  return err.httpStatus ?? httpStatusForEscrowCode(err.code);
}

export type EscrowErrorJson = {
  ok: false;
  error: string;
  message: string;
  fail_code: string;
  fail_reason: string;
  missing?: string[];
  details?: Record<string, unknown>;
};

export function escrowErrorJson(err: EscrowError): EscrowErrorJson {
  const message = redactDatabaseText(err.message);
  const details = err.details ? (redactPublicValue(err.details) as Record<string, unknown>) : undefined;
  return {
    ok: false,
    error: err.code,
    message,
    fail_code: err.code,
    fail_reason: message,
    ...(err.missing ? { missing: err.missing } : {}),
    ...(details ? { details } : {}),
  };
}

export function jsonForUnknown(message: string) {
  const safe = redactDatabaseText(message, "Request failed.");
  const leaked = safe !== message;
  return {
    ok: false as const,
    error: leaked ? "internal" : "unknown",
    message: safe,
    fail_code: leaked ? "internal" : "unknown",
    fail_reason: safe,
  };
}

