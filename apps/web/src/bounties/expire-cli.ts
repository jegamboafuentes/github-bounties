import { expireClaimLocks } from "./expire";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";

loadDotenvFiles();

async function main() {
  const { db, sql } = createDb();
  try {
    const result = await expireClaimLocks(db);
    console.log(
      `Expired ${result.expiredLockIds.length} lock(s); restored ${result.restoredBountyIds.length} bounty(ies) to funded.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
