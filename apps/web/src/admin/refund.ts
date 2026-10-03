import { eq } from "drizzle-orm";
import type { EnvMap } from "../auth/env";
import type { Database } from "../db/client";
import { bounties } from "../db/schema";
import { isEscrowError } from "../escrow/errors";
import { refundEscrow, type EscrowServiceOpts } from "../escrow/service";
import { insertAdminAudit } from "./audit";
import { isUuid } from "../ids";
import { AdminError } from "./errors";

export const ADMIN_REFUND_DISABLED_MESSAGE = "Refunds are disabled on this deployment.";
export const NOTHING_TO_REFUND_MESSAGE =
  "There is no funded escrow to refund. Cancel an unfunded draft separately.";

/** Statuses with nothing locked to send back. Cancelling a draft is not a refund. */
const NO_FUNDED_ESCROW = new Set(["pending_fund", "cancelled", "refunded", "expired"]);

/** Only the exact flag enables an admin refund. API_MONEY_ENABLED is the public money switch. */
export function adminRefundEnabled(env: EnvMap = process.env): boolean {
  return env.ADMIN_REFUND_ENABLED === "1";
}

/**
 * Admin entry to the existing poster refund. No new transfer path.
 * A bad or missing id is 404 before any audit. A deleted row is 410.
 * `ADMIN_REFUND_ENABLED` is checked only after that. `refundEscrow` still
 * applies its status, coverage, destination, and idempotency guards.
 * A draft, or a bounty that is already cancelled, refunded, or expired, is
 * `409 nothing_to_refund`. This does not cancel the draft.
 * Each contributor is paid at the recorded refund address.
 */
export async function adminRefundBounty(input: {
  bountyId: string;
  actorEmail: string;
  db: Database;
  env: EnvMap;
  rail?: EscrowServiceOpts["rail"];
  now?: Date;
}): Promise<{ id: string; status: string; refundTxHash: string | null }> {
  const now = input.now ?? new Date();
  const actorEmail = input.actorEmail.trim().toLowerCase();
  if (!isUuid(input.bountyId)) throw new AdminError(404, "not_found", "Not found.");

  const [bounty] = await input.db.select().from(bounties).where(eq(bounties.id, input.bountyId)).limit(1);
  if (!bounty) throw new AdminError(404, "not_found", "Not found.");
  if (bounty.deletedAt) {
    await insertAdminAudit(input.db, {
      actorEmail,
      action: "refund_bounty",
      target: input.bountyId,
      before: { status: bounty.status, deletedAt: bounty.deletedAt.toISOString() },
      after: { reason: "deleted" },
      result: "refused",
      now,
    });
    throw new AdminError(410, "not_found", "Not found.");
  }
  if (!adminRefundEnabled(input.env)) {
    await insertAdminAudit(input.db, {
      actorEmail,
      action: "refund_bounty",
      target: input.bountyId,
      before: { status: bounty.status },
      after: { adminRefundEnabled: false, reason: "admin_refund_disabled" },
      result: "refused",
      now,
    });
    throw new AdminError(403, "admin_refund_disabled", ADMIN_REFUND_DISABLED_MESSAGE, {
      adminRefundEnabled: false,
    });
  }
  if (NO_FUNDED_ESCROW.has(bounty.status)) {
    await insertAdminAudit(input.db, {
      actorEmail,
      action: "refund_bounty",
      target: input.bountyId,
      before: { status: bounty.status },
      after: { reason: "nothing_to_refund" },
      result: "refused",
      now,
    });
    throw new AdminError(409, "nothing_to_refund", NOTHING_TO_REFUND_MESSAGE);
  }

  try {
    const refunded = await refundEscrow(
      input.bountyId,
      { actorUserId: bounty.posterUserId, reason: "cancel" },
      { db: input.db, rail: input.rail, now },
    );
    await insertAdminAudit(input.db, {
      actorEmail,
      action: "refund_bounty",
      target: input.bountyId,
      before: { status: bounty.status },
      after: { status: refunded.bountyStatus, refundTxHash: refunded.refundTxHash },
      network: refunded.network,
      txHash: refunded.refundTxHash,
      result: "ok",
      now,
    });
    return { id: input.bountyId, status: refunded.bountyStatus, refundTxHash: refunded.refundTxHash };
  } catch (err) {
    if (isEscrowError(err)) {
      await insertAdminAudit(input.db, {
        actorEmail,
        action: "refund_bounty",
        target: input.bountyId,
        before: { status: bounty.status },
        after: { code: err.code, reason: err.code },
        result: "refused",
        now,
      });
      const status = err.httpStatus ?? (err.code === "bounty_not_found" ? 404 : 409);
      const code = err.code === "bounty_not_found" && status === 410 ? "not_found" : err.code;
      throw new AdminError(status, code, err.message, err.details ?? null);
    }
    throw err;
  }
}
