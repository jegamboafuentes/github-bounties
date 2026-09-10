import { expireClaimLocks } from "./expire";
import { createDb } from "../db/client";
import { expireUnmergedBounties } from "../escrow";
import { loadDotenvFiles } from "../db/load-dotenv";

loadDotenvFiles();

async function main() {
  const { db, sql } = createDb();
  try {
    const result = await expireClaimLocks(db);
    const money = await expireUnmergedBounties({ db });
    console.log(
      `Expired ${result.expiredLockIds.length} lock(s); restored ${result.restoredBountyIds.length} bounty(ies) to funded.`,
    );
    console.log(
      `Refunded ${money.refundedBountyIds.length} expired funded bounty(ies); voided ${money.voidedBountyIds.length} unfunded.`,
    );
    if (money.errors.length) {
      console.log(`Refund errors: ${money.errors.length}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
