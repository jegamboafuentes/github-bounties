import { eq, sql } from "drizzle-orm";
import { amountEditRefusal, BOUNTY_NOT_EDITABLE_MESSAGE } from "../bounties/update-amount";
import type { Database } from "../db/client";
import { bountyContributions, bounties, escrows } from "../db/schema";
import { loadAllocationLegs } from "../escrow/allocation";
import { probeCdpEnv, type CdpRailMode } from "../escrow/env";
import { insertAdminAudit } from "./audit";
import { AdminError } from "./errors";

export const BOUNTY_HAS_FUNDS_REFUND_FIRST = "bounty_has_funds_refund_first";

/**
 * Soft-delete an unfunded bounty. Uses the same funding predicate as
 * `updateBountyAmount`, under a row lock. Funded bounties stay put.
 */
export async function softDeleteBounty(input: {
  bountyId: string;
  actorEmail: string;
  db: Database;
  now?: Date;
  railMode?: CdpRailMode;
}): Promise<{ id: string; deletedAt: Date }> {
  const now = input.now ?? new Date();
  const railMode = input.railMode ?? probeCdpEnv().mode;
  const actorEmail = input.actorEmail.trim().toLowerCase();

  return input.db.transaction(async (tx) => {
    const database = tx as unknown as Database;
    await database.execute(sql`select id from bounties where id = ${input.bountyId} for update`);
    await database.execute(sql`select id from escrows where bounty_id = ${input.bountyId} for update`);

    const [bounty] = await database.select().from(bounties).where(eq(bounties.id, input.bountyId)).limit(1);
    if (!bounty || bounty.deletedAt) {
      throw new AdminError(404, "not_found", "Not found.");
    }

    const [escrow] = await database.select().from(escrows).where(eq(escrows.bountyId, input.bountyId)).limit(1);
    const contributions = await database
      .select({
        amountUsdc: bountyContributions.amountUsdc,
        fundTxHash: bountyContributions.fundTxHash,
      })
      .from(bountyContributions)
      .where(eq(bountyContributions.bountyId, input.bountyId));
    const allocationLegs = await loadAllocationLegs(database, input.bountyId);
    const refusal = amountEditRefusal({
      bountyStatus: bounty.status,
      escrow: escrow
        ? {
            status: escrow.status,
            amountUsdc: escrow.amountUsdc,
            fundTxHash: escrow.fundTxHash,
            x402PaymentId: escrow.x402PaymentId,
          }
        : null,
      contributions,
      allocationLegs: allocationLegs.map((leg) => ({
        kind: leg.kind,
        amountUsdc: leg.amountUsdc,
        txHash: leg.txHash,
        status: leg.status,
      })),
      railMode,
    });
    if (refusal === "not_editable") {
      throw new AdminError(409, "bounty_not_editable", BOUNTY_NOT_EDITABLE_MESSAGE);
    }
    if (refusal === "has_funds") {
      throw new AdminError(
        409,
        BOUNTY_HAS_FUNDS_REFUND_FIRST,
        "This bounty has funds, a contribution, a lock, or an in-flight allocation. Refund it before deleting.",
      );
    }

    await database
      .update(bounties)
      .set({ deletedAt: now, deletedBy: actorEmail, updatedAt: now })
      .where(eq(bounties.id, input.bountyId));
    await insertAdminAudit(database, {
      actorEmail,
      action: "delete_bounty",
      target: input.bountyId,
      before: { status: bounty.status, deletedAt: null },
      after: { deletedAt: now.toISOString(), deletedBy: actorEmail },
      result: "ok",
      now,
    });
    return { id: input.bountyId, deletedAt: now };
  });
}
