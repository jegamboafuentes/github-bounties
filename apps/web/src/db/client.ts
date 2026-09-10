import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadDatabaseUrl, normalizeDatabaseUrl, unixSocketHostParam } from "./env";
import * as relations from "./relations";
import * as schema from "./schema";

const fullSchema = { ...schema, ...relations };

export type Database = ReturnType<typeof createDb>["db"];

/**
 * postgres.js options for `createDb`. Never include or log the URL.
 *
 * Query `host=/absolute/path` is ignored as a connect host (it becomes a
 * startup GUC). Pass it as `options.host` so postgres.js sets
 * `path` to `<socketDir>/.s.PGSQL.<port>` and skips TCP to localhost.
 */
export function postgresConnectOptions(databaseUrl: string): {
  max: 1;
  onnotice: () => void;
  host?: string;
} {
  const options: { max: 1; onnotice: () => void; host?: string } = {
    max: 1,
    onnotice: () => {},
  };
  const socket = unixSocketHostParam(databaseUrl);
  if (socket) options.host = socket;
  return options;
}

export function createDb(databaseUrl = loadDatabaseUrl()) {
  const url = normalizeDatabaseUrl(databaseUrl);
  const sql = postgres(url, postgresConnectOptions(url));
  const db = drizzle(sql, { schema: fullSchema });
  return { db, sql };
}
