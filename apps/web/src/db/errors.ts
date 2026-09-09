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
