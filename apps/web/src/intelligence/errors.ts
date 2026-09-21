/**
 * Safe intelligence failure codes for UI + Cloud Run logs.
 * Never include GEMINI_API_KEY, connection strings, or raw exception text.
 */

export const INTELLIGENCE_UNAVAILABLE_HEADLINE = "Intelligence unavailable";

const SAFE_ERROR_REASON =
  /^(missing_key|missing_table|cache_read|cache_write|cache_error|gemini_parse|gemini_timeout|gemini_fetch|gemini_http_\d{3}|error)$/;

export function sanitizeIntelligenceErrorReason(
  raw: string | null | undefined,
): string | undefined {
  const value = raw?.trim() ?? "";
  if (!value) return undefined;
  if (SAFE_ERROR_REASON.test(value)) return value;
  return "error";
}

export function pgCodeOf(err: unknown): string | undefined {
  let current: unknown = err;
  for (let i = 0; i < 4 && current && typeof current === "object"; i += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isUndefinedTableError(err: unknown): boolean {
  if (pgCodeOf(err) === "42P01") return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /bounty_intelligence/i.test(message) && /does not exist/i.test(message);
}

export function classifyIntelligenceFailure(err: unknown): {
  code: string;
  pgCode?: string;
} {
  const pgCode = pgCodeOf(err);
  if (isUndefinedTableError(err)) {
    return { code: "missing_table", pgCode: pgCode ?? "42P01" };
  }
  return { code: "error", pgCode };
}

export function intelligenceUnavailableCopy(args: {
  reason: "missing_key" | "error";
  errorReason?: string;
}): { headline: string; detail: string } {
  if (args.reason === "missing_key") {
    return { headline: INTELLIGENCE_UNAVAILABLE_HEADLINE, detail: "missing_key" };
  }
  const code = sanitizeIntelligenceErrorReason(args.errorReason) ?? "error";
  return { headline: INTELLIGENCE_UNAVAILABLE_HEADLINE, detail: `error · ${code}` };
}

/** Cloud Run stdout — no API keys, payloads, or secrets. */
export function logIntelligenceEvent(
  event: string,
  details: Record<string, unknown> = {},
): void {
  const rest = { ...details };
  delete rest.apiKey;
  delete rest.key;
  delete rest.GEMINI_API_KEY;
  delete rest.NEXT_PUBLIC_GEMINI_API_KEY;
  console.error(JSON.stringify({ event, ...rest }));
}
