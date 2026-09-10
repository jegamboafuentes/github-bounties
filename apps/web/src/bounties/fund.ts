import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, escrows } from "../db/schema";
import { BountyError } from "./errors";

export type FundedBounty = {
  id: string;
  status: "funded";
  fundedAt: Date;
};

/**
 * Stub fund: pending_fund → funded. No CDP, no USDC movement (V1-5).
 * Poster-only. Creates/updates the 1:1 escrow row as funded.
 */
export async function stubFundBounty(
  bountyId: string,
  actorUserId: string,
  db: Database,
  now: Date = new Date(),
): Promise<FundedBounty> {
  if (!actorUserId) {
    throw new BountyError("unauthorized", "Sign in with Google to fund a bounty.");
  }

  const [bounty] = await db.select().from(bounties).where(eq(bounties.id, bountyId)).limit(1);
  if (!bounty) {
    throw new BountyError("bounty_not_found", "Bounty not found.");
  }
  if (bounty.posterUserId !== actorUserId) {
    throw new BountyError("not_poster", "Only the poster can stub-fund this bounty.");
  }
  if (bounty.status !== "pending_fund") {
    throw new BountyError(
      "not_fundable",
      `Bounty is ${bounty.status}, not pending_fund.`,
    );
  }

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(bounties)
      .set({
        status: "funded",
        fundedAt: now,
        updatedAt: now,
      })
      .where(and(eq(bounties.id, bountyId), eq(bounties.status, "pending_fund")))
      .returning({ id: bounties.id });

    if (!updated) {
      throw new BountyError("not_fundable", "Bounty is no longer pending_fund.");
    }

    const [existing] = await tx
      .select({ id: escrows.id })
      .from(escrows)
      .where(eq(escrows.bountyId, bountyId))
      .limit(1);

    if (existing) {
      await tx
        .update(escrows)
        .set({ status: "funded", amountUsdc: bounty.amountUsdc, updatedAt: now })
        .where(eq(escrows.id, existing.id));
    } else {
      await tx.insert(escrows).values({
        bountyId,
        amountUsdc: bounty.amountUsdc,
        status: "funded",
      });
    }
  });

  return { id: bountyId, status: "funded", fundedAt: now };
}
