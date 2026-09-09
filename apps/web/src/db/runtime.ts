import { createDb, type Database } from "./client";

let runtime: ReturnType<typeof createDb> | undefined;

/** Process-wide Drizzle client for request handlers. Do not import from Edge proxy. */
export function getRuntimeDb(): Database {
  if (!runtime) {
    runtime = createDb();
  }
  return runtime.db;
}
