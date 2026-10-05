import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { pollHfMerges } from "./hf-merge-poller";

loadDotenvFiles();

async function main() {
  const { db, sql } = createDb();
  try {
    const result = await pollHfMerges(db);
    console.log(
      `Hugging Face merge poll: scanned ${result.scanned}, eligible ${result.eligible}, claims written ${result.claimsWritten}, duplicates ${result.duplicates}, errors ${result.errors.length}${result.skipped ? `, skipped ${result.skipped}` : ""}.`,
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
