import { eq } from "drizzle-orm";
import { apiMoneyEnabled } from "../api/access/policy";
import { MONEY_ACTIONS_DISABLED } from "../api/access/money-wording";
import type { EnvMap } from "../auth/env";
import type { Database } from "../db/client";
import { bounties } from "../db/schema";
import { isEscrowError } from "../escrow/errors";
import { refundEscrow, type EscrowServiceOpts } from "../escrow/service";
import { insertAdminAudit } from "./audit";
import { isUuid } from "../ids";
import { AdminError } from "./errors";

/**
 * Admin entry to the existing poster refund. No new transfer path.
 * The money flag is checked first. `refundEscrow` still applies its status,
 * coverage, and destination guards. The destination is the recorded payer.
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
  if (!apiMoneyEnabled(input.env as NodeJS.ProcessEnv)) {
    await insertAdminAudit(input.db, {
      actorEmail,
      action: "refund_bounty",
      target: input.bountyId,
      before: null,
      after: { apiMoneyEnabled: false, reason: "money_disabled" },
      result: "refused",
      now,
    });
    throw new AdminError(403, "money_disabled", MONEY_ACTIONS_DISABLED, { apiMoneyEnabled: false });
  }

  const [bounty] = await input.db.select().from(bounties).where(eq(bounties.id, input.bountyId)).limit(1);
  if (!bounty || bounty.deletedAt) {
    if (bounty?.deletedAt) {
      await insertAdminAudit(input.db, {
        actorEmail,
        action: "refund_bounty",
        target: input.bountyId,
        before: { status: bounty.status, deletedAt: bounty.deletedAt.toISOString() },
        after: { reason: "not_found" },
        result: "refused",
        now,
      });
    }
    throw new AdminError(404, "not_found", "Not found.");
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
      const status = err.code === "bounty_not_found" ? 404 : 409;
      throw new AdminError(status, err.code, err.message, err.details ?? null);
    }
    throw err;
  }
}
