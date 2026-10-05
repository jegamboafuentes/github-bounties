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

/** Constraint name on a Postgres unique_violation, including drizzle wrappers. */
export function uniqueViolationConstraint(err: unknown): string | null {
  let current: unknown = err;
  for (let i = 0; i < 6 && current; i++) {
    if (typeof current === "object" && current !== null) {
      const record = current as { constraint_name?: unknown; constraint?: unknown; message?: unknown };
      const named = record.constraint_name ?? record.constraint;
      if (typeof named === "string" && named.trim()) return named.trim();
      const message =
        current instanceof Error
          ? current.message
          : typeof record.message === "string"
            ? record.message
            : "";
      const match = /unique constraint "([^"]+)"/i.exec(message);
      if (match?.[1]) return match[1];
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return null;
}
