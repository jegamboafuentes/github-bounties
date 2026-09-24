import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { pollPublicMerges } from "./public-merge-poller";

loadDotenvFiles();

async function main() {
  const { db, sql } = createDb();
  try {
    const result = await pollPublicMerges(db);
    console.log(
      `Public merge poll: scanned ${result.scanned}, eligible ${result.eligible}, claims written ${result.claimsWritten}, duplicates ${result.duplicates}, errors ${result.errors.length}.`,
    );
    for (const error of result.errors) {
      console.log(`error bounty=${error.bountyId} ${error.message}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
