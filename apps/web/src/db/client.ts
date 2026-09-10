import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  loadDatabaseUrl,
  normalizeDatabaseUrl,
  stripUnixSocketHostQuery,
  unixSocketHostParam,
} from "./env";
import * as relations from "./relations";
import * as schema from "./schema";

const fullSchema = { ...schema, ...relations };

export type Database = ReturnType<typeof createDb>["db"];

/**
 * postgres.js options for `createDb`. Never include or log the URL.
 *
 * Query `host=/absolute/path` is ignored as a connect host (it becomes a
 * startup GUC that Postgres rejects with 42704). Pass it as `options.host`
 * so postgres.js sets `path` to `<socketDir>/.s.PGSQL.<port>` and skips TCP
 * to localhost. The URL passed to `postgres()` must not still contain `host=`.
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

/**
 * URL + options for `postgres()`. Read the unix-socket host first, then strip
 * `host=` from the query so it is not forwarded as a startup GUC.
 */
export function postgresConnectArgs(databaseUrl: string): {
  url: string;
  options: { max: 1; onnotice: () => void; host?: string };
} {
  const normalized = normalizeDatabaseUrl(databaseUrl);
  return {
    url: stripUnixSocketHostQuery(normalized),
    options: postgresConnectOptions(normalized),
  };
}

export function createDb(databaseUrl = loadDatabaseUrl()) {
  const { url, options } = postgresConnectArgs(databaseUrl);
  const sql = postgres(url, options);
  const db = drizzle(sql, { schema: fullSchema });
  return { db, sql };
}
