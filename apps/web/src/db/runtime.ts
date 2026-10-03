import { createDb, type Database } from "./client";

let runtime: ReturnType<typeof createDb> | undefined;

/** Process-wide Drizzle client for request handlers. Do not import from Edge proxy. */
export function getRuntimeDb(): Database {
  if (!runtime) {
    runtime = createDb();
  }
  return runtime.db;
}

/** Tests that call a handler using {@link getRuntimeDb} must close it or the process stays up. */
export async function closeRuntimeDb(): Promise<void> {
  if (!runtime) return;
  const current = runtime;
  runtime = undefined;
  await current.sql.end({ timeout: 5 });
}
