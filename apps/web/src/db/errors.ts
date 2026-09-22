/** Postgres unique_violation and drizzle/postgres-js wrappers. */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 6 && current; i++) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      (current as { code?: string }).code === "23505"
    ) {
      return true;
    }
    const message =
      current instanceof Error
        ? current.message
        : typeof current === "object" && current !== null && "message" in current
          ? String((current as { message?: unknown }).message)
          : "";
    if (/duplicate key|unique constraint|23505/i.test(message)) {
      return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

/**
 * 42703 undefined_column / 42P01 undefined_table.
 * Sign-in falls back to the pre-0006 upsert when DEV/PROD has not applied
 * `0006_user_identity_email_outbox` yet, so login is not blocked on the outbox.
 */
export function isMissingIdentitySchema(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 6 && current; i++) {
    if (typeof current === "object" && current !== null && "code" in current) {
      const code = (current as { code?: string }).code;
      if (code === "42703" || code === "42P01") return true;
    }
    const message =
      current instanceof Error
        ? current.message
        : typeof current === "object" && current !== null && "message" in current
          ? String((current as { message?: unknown }).message)
          : "";
    if (
      /42703|42P01/.test(message) ||
      /column "(avatar_url|last_seen_at)"/i.test(message) ||
      /relation "email_outbox" does not exist/i.test(message)
    ) {
      return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}
