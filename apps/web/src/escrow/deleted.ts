import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties } from "../db/schema";
import { EscrowError } from "./errors";

/** Soft-deleted bounty. Status 410, checked before hash verification. */
export function bountyGoneError(): EscrowError {
  return new EscrowError("bounty_not_found", "Bounty not found.", { httpStatus: 410 });
}

/**
 * Deleted bounties are gone before any fund-hash or lock check.
 * A missing row is left for the caller (404). A bad id must be rejected first.
 */
export async function rejectIfBountyDeleted(db: Database, bountyId: string): Promise<void> {
  const [bounty] = await db
    .select({ deletedAt: bounties.deletedAt })
    .from(bounties)
    .where(eq(bounties.id, bountyId))
    .limit(1);
  if (bounty?.deletedAt) throw bountyGoneError();
}
