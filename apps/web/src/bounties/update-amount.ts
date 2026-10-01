import { eq, sql } from "drizzle-orm";
import type { BountyAmountChangeSource } from "../db/schema";
import type { Database } from "../db/client";
import { bountyAmountChanges, bountyContributions, bounties, escrows } from "../db/schema";
import { loadAllocationLegs } from "../escrow/allocation";
import type { CdpRailMode } from "../escrow/env";
import { probeCdpEnv } from "../escrow/env";
import { inboundIsRecorded } from "../escrow/inbound";
import { alreadyPaidAtomic, verifiedInflowAtomic } from "../escrow/payout-guard";
import { OPEN_MONEY_BOUNTY_STATUSES } from "../escrow/state";
import { usdcToAtomic } from "../lib/money";
import {
  IN_FLIGHT_BOUNTY_STATUSES,
  TRANSACTED_ESCROW_STATUSES,
} from "../stats/definitions";
import { normalizeBountyAmountUsdc } from "./amount";
import { BountyError } from "./errors";

export const BOUNTY_HAS_FUNDS_MESSAGE =
  "This bounty already has funds or a payment in progress. The amount can be changed only while it is unfunded.";

export const BOUNTY_NOT_EDITABLE_MESSAGE =
  "Only an unfunded pending bounty can be edited or deleted.";

export type AmountEditRefusal = "ok" | "not_editable" | "has_funds";

const UNFUNDED_STATUS = "pending_fund";
const UNFUNDED_ESCROW_STATUS = "pending";

export type AmountEditFunding = {
  bountyStatus: string;
  escrow: {
    status: string;
    amountUsdc: string;
    fundTxHash: string | null;
    x402PaymentId: string | null;
  } | null;
  contributions: { amountUsdc: string; fundTxHash: string }[];
  allocationLegs: { kind: string; amountUsdc: string; txHash: string | null; status: string }[];
  railMode: CdpRailMode;
};

/**
 * True when money, an inbound, or an in-flight leg is already on the bounty.
 * A cancelled or settled draft with none of that is not "funded".
 */
function fundingRecorded(input: AmountEditFunding): boolean {
  if ((IN_FLIGHT_BOUNTY_STATUSES as readonly string[]).includes(input.bountyStatus)) return true;
  if ((OPEN_MONEY_BOUNTY_STATUSES as readonly string[]).includes(input.bountyStatus)) return true;
  const escrow = input.escrow;
  if (escrow && escrow.status !== UNFUNDED_ESCROW_STATUS) return true;
  if (escrow && (TRANSACTED_ESCROW_STATUSES as readonly string[]).includes(escrow.status)) return true;
  if (inboundIsRecorded(escrow)) return true;
  if (input.contributions.length > 0) return true;
  if (
    escrow &&
    verifiedInflowAtomic({
      railMode: input.railMode,
      escrow: {
        amountUsdc: escrow.amountUsdc,
        fundTxHash: escrow.fundTxHash,
        x402PaymentId: escrow.x402PaymentId,
      },
      contributions: input.contributions,
    }) > BigInt(0)
  ) {
    return true;
  }
  if (
    input.allocationLegs.some(
      (leg) => leg.status === "pending" || leg.status === "submitted" || Boolean(leg.txHash?.trim()),
    )
  ) {
    return true;
  }
  if (alreadyPaidAtomic({ legs: input.allocationLegs, refundedContributions: [] }) > BigInt(0)) {
    return true;
  }
  return false;
}

/**
 * `has_funds` when anything is funded or in flight.
 * `not_editable` when the status is not pending_fund and nothing was funded.
 * Work signals and winner claims do not count: they are not funding.
 */
export function amountEditRefusal(input: AmountEditFunding): AmountEditRefusal {
  if (fundingRecorded(input)) return "has_funds";
  if (input.bountyStatus !== UNFUNDED_STATUS) return "not_editable";
  if (!input.escrow || input.escrow.status !== UNFUNDED_ESCROW_STATUS) return "has_funds";
  return "ok";
}

/** True when the face must stay put. */
export function bountyAmountEditBlocked(input: AmountEditFunding): boolean {
  return amountEditRefusal(input) !== "ok";
}

function throwAmountEditRefusal(refusal: AmountEditRefusal): void {
  if (refusal === "has_funds") {
    throw new BountyError("bounty_has_funds", BOUNTY_HAS_FUNDS_MESSAGE);
  }
  if (refusal === "not_editable") {
    throw new BountyError("bounty_not_editable", BOUNTY_NOT_EDITABLE_MESSAGE);
  }
}

/** Create-validator rules, plus a real change against the current face. */
export function assertNewBountyAmount(currentUsdc: string, raw: string): string {
  const next = normalizeBountyAmountUsdc(raw);
  if (usdcToAtomic(next) === usdcToAtomic(currentUsdc)) {
    throw new BountyError("amount_unchanged", `The amount is already ${next} USDC.`);
  }
  return next;
}

export type UpdateBountyAmountInput = {
  bountyId: string;
  actorUserId: string;
  amountUsdc: string;
  source: BountyAmountChangeSource;
  apiKeyId?: string | null;
  db: Database;
  now?: Date;
  railMode?: CdpRailMode;
};

export type UpdatedBountyAmount = {
  id: string;
  status: "pending_fund";
  oldAmountUsdc: string;
  newAmountUsdc: string;
};

export function logBountyAmountChanged(entry: {
  bountyId: string;
  actorUserId: string;
  oldAmountUsdc: string;
  newAmountUsdc: string;
  source: BountyAmountChangeSource;
  apiKeyId?: string | null;
}): void {
  console.log(
    JSON.stringify({
      event: "bounty_amount_changed",
      bountyId: entry.bountyId,
      actorUserId: entry.actorUserId,
      oldAmountUsdc: entry.oldAmountUsdc,
      newAmountUsdc: entry.newAmountUsdc,
      source: entry.source,
      apiKeyId: entry.apiKeyId ?? null,
    }),
  );
}

/**
 * Poster-only face edit while nothing is funded.
 * Locks the bounty row, re-reads funding, then writes the bounty, the pending
 * escrow face, and one audit row.
 */
export async function updateBountyAmount(input: UpdateBountyAmountInput): Promise<UpdatedBountyAmount> {
  if (!input.actorUserId) {
    throw new BountyError("unauthorized", "Sign in with Google to edit a bounty amount.");
  }
  const now = input.now ?? new Date();
  const railMode = input.railMode ?? probeCdpEnv().mode;
  const apiKeyId = input.apiKeyId ?? null;

  const updated = await input.db.transaction(async (tx) => {
    const database = tx as unknown as Database;
    await database.execute(sql`select id from bounties where id = ${input.bountyId} for update`);
    await database.execute(sql`select id from escrows where bounty_id = ${input.bountyId} for update`);

    const [bounty] = await database.select().from(bounties).where(eq(bounties.id, input.bountyId)).limit(1);
    if (!bounty) {
      throw new BountyError("bounty_not_found", "Bounty not found.");
    }
    if (bounty.posterUserId !== input.actorUserId) {
      throw new BountyError("not_poster", "Only the poster can edit this bounty's amount.");
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
    throwAmountEditRefusal(
      amountEditRefusal({
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
      }),
    );

    const next = assertNewBountyAmount(bounty.amountUsdc, input.amountUsdc);
    const [saved] = await database
      .update(bounties)
      .set({ amountUsdc: next, updatedAt: now })
      .where(eq(bounties.id, bounty.id))
      .returning({ id: bounties.id, status: bounties.status, amountUsdc: bounties.amountUsdc });
    if (!saved || saved.status !== "pending_fund") {
      throwAmountEditRefusal(saved && ["cancelled", "expired", "void", "settled"].includes(saved.status) ? "not_editable" : "has_funds");
    }
    if (escrow) {
      await database
        .update(escrows)
        .set({ amountUsdc: next, updatedAt: now })
        .where(eq(escrows.id, escrow.id));
    }
    await database.insert(bountyAmountChanges).values({
      bountyId: bounty.id,
      oldAmountUsdc: bounty.amountUsdc,
      newAmountUsdc: next,
      actorUserId: input.actorUserId,
      source: input.source,
      apiKeyId,
      createdAt: now,
    });
    return {
      id: saved.id,
      status: "pending_fund" as const,
      oldAmountUsdc: bounty.amountUsdc,
      newAmountUsdc: saved.amountUsdc,
    };
  });

  logBountyAmountChanged({
    bountyId: updated.id,
    actorUserId: input.actorUserId,
    oldAmountUsdc: updated.oldAmountUsdc,
    newAmountUsdc: updated.newAmountUsdc,
    source: input.source,
    apiKeyId,
  });
  return updated;
}
