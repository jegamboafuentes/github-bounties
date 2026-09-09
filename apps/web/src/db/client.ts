import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadDatabaseUrl } from "./env";
import * as relations from "./relations";
import * as schema from "./schema";

const fullSchema = { ...schema, ...relations };

export type Database = ReturnType<typeof createDb>["db"];

export function createDb(databaseUrl = loadDatabaseUrl()) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(sql, { schema: fullSchema });
  return { db, sql };
}
