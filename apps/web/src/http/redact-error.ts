/**
 * Database drivers put the SQL text in Error.message (`Failed query: select …`).
 * Log that server-side and never copy it into an API body.
 */
const DATABASE_TEXT =
  /failed query:|invalid input syntax|syntax error at or near|\bSQLSTATE\b|duplicate key value|violates (?:[\w-]+ )?constraint|relation ["']|column ["'][^"']*["'] does not exist|drizzle-orm|postgres(?:ql)? error/i;

export function looksLikeDatabaseText(value: string): boolean {
  return DATABASE_TEXT.test(value);
}

export function redactDatabaseText(value: string, fallback = "Request failed."): string {
  if (!looksLikeDatabaseText(value)) return value;
  console.error(
    JSON.stringify({
      event: "api_error_redacted",
      message: value,
    }),
  );
  return fallback;
}

export function redactPublicValue(value: unknown): unknown {
  if (typeof value === "string") return redactDatabaseText(value);
  if (Array.isArray(value)) return value.map((item) => redactPublicValue(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactPublicValue(item);
    }
    return out;
  }
  return value;
}
