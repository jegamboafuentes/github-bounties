import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { bountyContributions, bounties, claimLocks, escrows } from "../db/schema";
import { loadAllocationLegs } from "../escrow/allocation";
import {
  DELETED_BOUNTY_INBOUND_CODE,
  DELETED_BOUNTY_INBOUND_REASON,
  VOIDED_UNFUNDED_CODE,
  VOIDED_UNFUNDED_REASON,
} from "../escrow/fail";
import { unappliedSettledInbound } from "../escrow/reconcile";
import { insertAdminAudit } from "./audit";
import {
  deleteBlockedMessage,
  deleteBlockReasons,
  type DeleteBlockReason,
  type DeleteGuardInput,
} from "./delete-guard";
import { AdminError } from "./errors";

export const BOUNTY_HAS_FUNDS_REFUND_FIRST = "bounty_has_funds_refund_first";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class DeleteBlocked extends Error {
  constructor(readonly reasons: DeleteBlockReason[]) {
    super("delete_blocked");
    this.name = "DeleteBlocked";
  }
}

type BountyRow = typeof bounties.$inferSelect;

type DeleteFacts = {
  bounty: BountyRow;
  guard: DeleteGuardInput;
};

function notFound(): AdminError {
  return new AdminError(404, "not_found", "Not found.");
}

async function loadDeleteFacts(db: Database, bountyId: string, lock: boolean): Promise<DeleteFacts | null> {
  if (lock) {
    await db.execute(sql`select id from bounties where id = ${bountyId} for update`);
    await db.execute(sql`select id from escrows where bounty_id = ${bountyId} for update`);
  }
  const [bounty] = await db.select().from(bounties).where(eq(bounties.id, bountyId)).limit(1);
  if (!bounty) return null;
  const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, bountyId)).limit(1);
  const contributions = await db
    .select({
      amountUsdc: bountyContributions.amountUsdc,
      refundTxHash: bountyContributions.refundTxHash,
    })
    .from(bountyContributions)
    .where(eq(bountyContributions.bountyId, bountyId));
  const locks = await db
    .select({ status: claimLocks.status })
    .from(claimLocks)
    .where(eq(claimLocks.bountyId, bountyId));
  const allocationLegs = await loadAllocationLegs(db, bountyId);
  return {
    bounty,
    guard: {
      escrow: escrow
        ? {
            status: escrow.status,
            amountUsdc: escrow.amountUsdc,
            refundTxHash: escrow.refundTxHash,
          }
        : null,
      contributions,
      claimLocks: locks,
      allocationLegs: allocationLegs.map((leg) => ({
        kind: leg.kind,
        amountUsdc: leg.amountUsdc,
        status: leg.status,
      })),
    },
  };
}

async function auditRefusal(
  db: Database,
  input: { bountyId: string; actorEmail: string; status: string; reasons: DeleteBlockReason[]; now: Date },
): Promise<void> {
  await insertAdminAudit(db, {
    actorEmail: input.actorEmail,
    action: "delete_bounty",
    target: input.bountyId,
    before: { status: input.status, deletedAt: null },
    after: { deletedAt: null, blockedBy: input.reasons, reason: input.reasons[0] ?? BOUNTY_HAS_FUNDS_REFUND_FIRST },
    result: "refused",
    now: input.now,
  });
}

function blockedError(reasons: DeleteBlockReason[]): AdminError {
  return new AdminError(409, BOUNTY_HAS_FUNDS_REFUND_FIRST, deleteBlockedMessage(reasons), { reasons });
}

/**
 * Soft-delete a bounty that is paid, cancelled, refunded, or never funded.
 * A refusal writes an audit row and does not update the bounty.
 * The amount-edit guard is intentionally not used here.
 */
export async function softDeleteBounty(input: {
  bountyId: string;
  actorEmail: string;
  db: Database;
  now?: Date;
}): Promise<{ id: string; deletedAt: Date }> {
  const now = input.now ?? new Date();
  const actorEmail = input.actorEmail.trim().toLowerCase();
  if (!UUID.test(input.bountyId)) throw notFound();

  const preview = await loadDeleteFacts(input.db, input.bountyId, false);
  if (!preview || preview.bounty.deletedAt) throw notFound();
  const reasons = deleteBlockReasons(preview.guard);
  if (reasons.length > 0) {
    await auditRefusal(input.db, {
      bountyId: input.bountyId,
      actorEmail,
      status: preview.bounty.status,
      reasons,
      now,
    });
    throw blockedError(reasons);
  }

  try {
    return await input.db.transaction(async (tx) => {
      const database = tx as unknown as Database;
      const locked = await loadDeleteFacts(database, input.bountyId, true);
      if (!locked || locked.bounty.deletedAt) throw notFound();
      const again = deleteBlockReasons(locked.guard);
      if (again.length > 0) throw new DeleteBlocked(again);
      const [escrow] = await database.select().from(escrows).where(eq(escrows.bountyId, input.bountyId)).limit(1);
      const nextStatus = locked.bounty.status === "pending_fund" ? "cancelled" : locked.bounty.status;
      const [saved] = await database
        .update(bounties)
        .set({
          status: nextStatus,
          deletedAt: now,
          deletedBy: actorEmail,
          updatedAt: now,
        })
        .where(and(eq(bounties.id, input.bountyId), isNull(bounties.deletedAt)))
        .returning({ id: bounties.id });
      if (!saved) throw notFound();
      if (escrow?.status === "pending") {
        const review = unappliedSettledInbound({
          escrowStatus: escrow.status,
          fundTxHash: escrow.fundTxHash,
          x402PaymentId: escrow.x402PaymentId,
        });
        await database
          .update(escrows)
          .set({
            status: "failed",
            failCode: review ? DELETED_BOUNTY_INBOUND_CODE : (escrow.failCode ?? VOIDED_UNFUNDED_CODE),
            failReason: review
              ? DELETED_BOUNTY_INBOUND_REASON
              : (escrow.failReason ?? VOIDED_UNFUNDED_REASON),
            updatedAt: now,
          })
          .where(and(eq(escrows.id, escrow.id), eq(escrows.status, "pending")));
      }
      await insertAdminAudit(database, {
        actorEmail,
        action: "delete_bounty",
        target: input.bountyId,
        before: { status: locked.bounty.status, deletedAt: null },
        after: {
          status: nextStatus,
          deletedAt: now.toISOString(),
          deletedBy: actorEmail,
          escrowVoided: escrow?.status === "pending",
        },
        result: "ok",
        now,
      });
      return { id: input.bountyId, deletedAt: now };
    });
  } catch (err) {
    if (err instanceof DeleteBlocked) {
      await auditRefusal(input.db, {
        bountyId: input.bountyId,
        actorEmail,
        status: preview.bounty.status,
        reasons: err.reasons,
        now,
      });
      throw blockedError(err.reasons);
    }
    throw err;
  }
}
