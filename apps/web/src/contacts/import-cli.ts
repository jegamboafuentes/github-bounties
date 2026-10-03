/**
 * One-shot campaign import. Ops runs this against a database.
 * The CSVs stay out of git. Do not print row contents.
 *
 *   npm run contacts:import -- --master <path> --suppressed <path>
 */

import { readFileSync } from "node:fs";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { importMarketingContactsFromCsv } from "./import";

loadDotenvFiles();

function flag(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    console.error("Usage: npm run contacts:import -- --master <path> --suppressed <path>");
    process.exit(2);
  }
  return value;
}

async function main(): Promise<void> {
  const masterPath = flag("--master");
  const suppressedPath = flag("--suppressed");
  const master = readFileSync(masterPath, "utf8");
  const suppressed = readFileSync(suppressedPath, "utf8");
  const { db, sql } = createDb();
  try {
    const counts = await importMarketingContactsFromCsv(db, { master, suppressed });
    console.log(`inserted=${counts.inserted} updated=${counts.updated} unsubscribed=${counts.unsubscribed}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "contacts import failed");
  process.exit(1);
});
