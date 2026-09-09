import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";
import { loadDotenvFiles } from "./load-dotenv";

loadDotenvFiles();

const here = fileURLToPath(new URL(".", import.meta.url));
const migrationsFolder = resolve(here, "../../drizzle");

async function main() {
  const { db, sql } = createDb();
  try {
    await migrate(db, { migrationsFolder });
    console.log("Migrations applied.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
