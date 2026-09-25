import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import {
  allocationLedger,
  allocationLedgerKindValues,
  poolParticipants,
  users,
} from "../db/schema";
import { CLAIM_SKIP } from "../webhooks/outcome";
import { type PostFeePoolSplit, usdcToAtomic } from "../lib/money";
import { moneyIdempotencyKey } from "./idempotency";
import type { RailTransferPurpose } from "./rail";
import type { MoneyKind } from "./state";

export type AllocationKind = (typeof allocationLedgerKindValues)[number];

export type FrozenSettleSet = {
  hasFreeze: boolean;
  eligibleCount: number;
  winner: typeof poolParticipants.$inferSelect | null;
  poolMembers: (typeof poolParticipants.$inferSelect)[];
  overflowCount: number;
};

export type PlannedLeg = {
  kind: AllocationKind;
  participantId: string | null;
  amountAtomic: bigint;
  amountUsdc: string;
  toAddress: string | null;
  purpose: RailTransferPurpose;
  railKind: MoneyKind;
  idempotencyKey: string;
  /** Missing wallet / unlinked: do not transfer; stay retryable. */
  deferReason: string | null;
};

/**
 * A later leg must not move an earlier leg's paid_at.
 * The first confirmation wins; a pool claim after the winner claim keeps the winner time.
 */
export function keptPaidAt(existing: Date | null | undefined, now: Date): Date {
  return existing ?? now;
}

/**
 * Ledger inserts used to leave created_at on the database clock (`defaultNow()`)
 * while updates wrote updated_at from a JavaScript Date captured earlier.
 * When those clocks disagree, updated_at can precede created_at. Never do that.
 */
export function ledgerUpdatedAt(createdAt: Date | null | undefined, now: Date): Date {
  if (!createdAt) return now;
  return createdAt.getTime() > now.getTime() ? createdAt : now;
}

/**
 * Winner Claim pays FEE_OUT + WINNER_PAYOUT only. Each pool member later
 * claims their own POOL_PAYOUT. `all` is the V2-3 ops/poster retry path.
 */
export type SettleScope = "winner_and_fee" | "pool_member" | "all";

/**
 * Long-lived per-leg keys (ADR 0003). FEE_OUT and the winner leg reuse the
 * V1-5 `gb-v1-5:` UUIDs so an in-flight hunter/fee retry cannot double-pay.
 * Each pool member gets its own key.
 */
export function allocationIdempotencyKey(
  bountyId: string,
  kind: AllocationKind,
  participantId?: string | null,
): string {
  if (kind === "FEE_OUT") {
    return moneyIdempotencyKey(bountyId, "FEE_OUT");
  }
  if (kind === "WINNER_PAYOUT") {
    return moneyIdempotencyKey(bountyId, "HUNTER_PAYOUT");
  }
  const hex = createHash("sha256")
    .update(`gb-v2-3:${bountyId}:POOL_PAYOUT:${participantId ?? ""}`)
    .digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Only a freeze (`frozen_at`) is payable. Unfrozen live-roster candidates
 * are ignored. Overflow is in |E| for math and is not paid.
 */
export async function loadFrozenSettleSet(
  db: Database,
  bountyId: string,
): Promise<FrozenSettleSet> {
  const rows = await db
    .select()
    .from(poolParticipants)
    .where(eq(poolParticipants.bountyId, bountyId));
  const frozen = rows.filter((row) => row.frozenAt != null);
  const poolMembers = frozen.filter((row) => row.role === "pool");
  const overflow = frozen.filter((row) => row.role === "overflow");
  const winner = frozen.find((row) => row.role === "winner") ?? null;
  return {
    hasFreeze: frozen.length > 0,
    eligibleCount: poolMembers.length + overflow.length,
    winner,
    poolMembers,
    overflowCount: overflow.length,
  };
}

export async function loadAllocationLegs(
  db: Database,
  bountyId: string,
): Promise<(typeof allocationLedger.$inferSelect)[]> {
  return db
    .select()
    .from(allocationLedger)
    .where(eq(allocationLedger.bountyId, bountyId));
}

export async function resolvePoolMemberAddress(
  db: Database,
  member: typeof poolParticipants.$inferSelect,
): Promise<string | null> {
  const fromRow = member.payoutAddress?.trim();
  if (fromRow) return fromRow;
  if (!member.userId) return null;
  const [row] = await db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, member.userId))
    .limit(1);
  return row?.walletAddress?.trim() || null;
}

/**
 * ADR 0003 intended legs. Empty |E|: FEE_OUT + WINNER_PAYOUT only.
 * Winner amount is `winner_atomic + dust` (post_fee when |E|=0).
 */
export function planSettleLegs(args: {
  bountyId: string;
  split: PostFeePoolSplit;
  winnerAddress: string;
  winnerParticipantId: string | null;
  feeAddress: string;
  poolMembers: { id: string; toAddress: string | null; userId: string | null }[];
}): PlannedLeg[] {
  const legs: PlannedLeg[] = [
    {
      kind: "WINNER_PAYOUT",
      participantId: args.winnerParticipantId,
      amountAtomic: args.split.winnerAtomic,
      amountUsdc: args.split.winnerUsdc,
      toAddress: args.winnerAddress,
      purpose: "hunter",
      railKind: "WINNER_PAYOUT",
      idempotencyKey: allocationIdempotencyKey(args.bountyId, "WINNER_PAYOUT"),
      deferReason: null,
    },
  ];

  if (args.split.feeAtomic > BigInt(0)) {
    legs.push({
      kind: "FEE_OUT",
      participantId: null,
      amountAtomic: args.split.feeAtomic,
      amountUsdc: args.split.feeUsdc,
      toAddress: args.feeAddress,
      purpose: "fee",
      railKind: "FEE_OUT",
      idempotencyKey: allocationIdempotencyKey(args.bountyId, "FEE_OUT"),
      deferReason: null,
    });
  }

  const shareUsdc = args.split.eachUsdc;
  if (shareUsdc && args.split.shareAtomic > BigInt(0)) {
    for (const member of args.poolMembers) {
      const toAddress = member.toAddress?.trim() || null;
      legs.push({
        kind: "POOL_PAYOUT",
        participantId: member.id,
        amountAtomic: args.split.shareAtomic,
        amountUsdc: shareUsdc,
        toAddress,
        purpose: "pool",
        railKind: "POOL_PAYOUT",
        idempotencyKey: allocationIdempotencyKey(
          args.bountyId,
          "POOL_PAYOUT",
          member.id,
        ),
        deferReason: toAddress
          ? null
          : member.userId
            ? "missing_payout_address"
            : CLAIM_SKIP.hunterNotLinked,
      });
    }
  }

  return legs;
}

export function sameParticipant(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? null) === (b ?? null);
}

export function shouldTransferLeg(
  leg: PlannedLeg,
  scope: SettleScope,
  participantId?: string | null,
): boolean {
  if (scope === "all") return true;
  if (scope === "winner_and_fee") {
    return leg.kind === "WINNER_PAYOUT" || leg.kind === "FEE_OUT";
  }
  return leg.kind === "POOL_PAYOUT" && sameParticipant(leg.participantId, participantId ?? null);
}

/** Missing wallet / unlinked is expected until that hunter Claims — not a rail fail. */
export function isExpectedPoolDefer(reason: string | null | undefined): boolean {
  return reason === "missing_payout_address" || reason === CLAIM_SKIP.hunterNotLinked;
}

export function findLedgerRow(
  rows: readonly (typeof allocationLedger.$inferSelect)[],
  kind: AllocationKind,
  participantId: string | null,
): (typeof allocationLedger.$inferSelect) | undefined {
  return rows.find(
    (row) => row.kind === kind && sameParticipant(row.participantId, participantId),
  );
}

export function legHasTxHash(
  row: { txHash?: string | null } | null | undefined,
): boolean {
  return Boolean(row?.txHash?.trim());
}

export async function ensurePendingLegs(
  db: Database,
  bountyId: string,
  legs: readonly PlannedLeg[],
  now: Date = new Date(),
): Promise<(typeof allocationLedger.$inferSelect)[]> {
  for (const leg of legs) {
    try {
      await db.insert(allocationLedger).values({
        bountyId,
        participantId: leg.participantId,
        kind: leg.kind,
        amountUsdc: leg.amountUsdc,
        toAddress: leg.toAddress,
        idempotencyKey: leg.idempotencyKey,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return loadAllocationLegs(db, bountyId);
}

async function stampLedger(
  db: Database,
  ledgerId: string,
  now: Date,
  patch: {
    status?: "pending" | "submitted" | "confirmed" | "failed";
    txHash?: string;
    toAddress?: string | null;
  },
): Promise<void> {
  const [row] = await db
    .select({ createdAt: allocationLedger.createdAt })
    .from(allocationLedger)
    .where(eq(allocationLedger.id, ledgerId))
    .limit(1);
  await db
    .update(allocationLedger)
    .set({ ...patch, updatedAt: ledgerUpdatedAt(row?.createdAt, now) })
    .where(eq(allocationLedger.id, ledgerId));
}

export async function markLegSubmitted(
  db: Database,
  ledgerId: string,
  now: Date,
): Promise<void> {
  await stampLedger(db, ledgerId, now, { status: "submitted" });
}

export async function markLegConfirmed(
  db: Database,
  args: {
    ledgerId: string;
    txHash: string;
    toAddress: string | null;
    now: Date;
  },
): Promise<void> {
  await stampLedger(db, args.ledgerId, args.now, {
    status: "confirmed",
    txHash: args.txHash,
    toAddress: args.toAddress,
  });
}

export async function markLegFailed(
  db: Database,
  ledgerId: string,
  now: Date,
): Promise<void> {
  await stampLedger(db, ledgerId, now, { status: "failed" });
}

export async function markPoolParticipantPaid(
  db: Database,
  args: {
    participantId: string;
    payoutAddress: string;
    payoutTxHash: string;
    now: Date;
  },
): Promise<void> {
  const [current] = await db
    .select({ paidAt: poolParticipants.paidAt })
    .from(poolParticipants)
    .where(eq(poolParticipants.id, args.participantId))
    .limit(1);
  await db
    .update(poolParticipants)
    .set({
      payoutAddress: args.payoutAddress,
      payoutTxHash: args.payoutTxHash,
      paidAt: keptPaidAt(current?.paidAt, args.now),
      skipReason: null,
      updatedAt: args.now,
    })
    .where(eq(poolParticipants.id, args.participantId));
}

export async function markPoolParticipantSkip(
  db: Database,
  participantId: string,
  skipReason: string,
  now: Date,
): Promise<void> {
  await db
    .update(poolParticipants)
    .set({ skipReason, updatedAt: now })
    .where(eq(poolParticipants.id, participantId));
}

/**
 * Refund/cancel before settle: void unused pending allocation rows.
 * Never reverse a confirmed transfer.
 */
export async function voidPendingAllocationLegs(
  db: Database,
  bountyId: string,
  now: Date,
): Promise<number> {
  const pending = await db
    .select({ id: allocationLedger.id, createdAt: allocationLedger.createdAt })
    .from(allocationLedger)
    .where(
      and(
        eq(allocationLedger.bountyId, bountyId),
        inArray(allocationLedger.status, ["pending", "submitted", "failed"]),
        isNull(allocationLedger.txHash),
      ),
    );
  if (pending.length === 0) return 0;
  for (const row of pending) {
    await db
      .update(allocationLedger)
      .set({ status: "failed", updatedAt: ledgerUpdatedAt(row.createdAt, now) })
      .where(eq(allocationLedger.id, row.id));
  }
  return pending.length;
}

export type ConfirmedOutflows = {
  winnerAtomic: bigint;
  poolAtomic: bigint;
  feeAtomic: bigint;
};

export function confirmedOutflowsFromLegs(
  legs: readonly { kind: string; amountUsdc: string; txHash: string | null; status: string }[],
): ConfirmedOutflows {
  const confirmed = legs.filter((leg) => leg.status === "confirmed" || Boolean(leg.txHash?.trim()));
  let winnerAtomic = BigInt(0);
  let poolAtomic = BigInt(0);
  let feeAtomic = BigInt(0);
  for (const leg of confirmed) {
    const amount = usdcToAtomic(leg.amountUsdc);
    if (leg.kind === "WINNER_PAYOUT") winnerAtomic += amount;
    else if (leg.kind === "POOL_PAYOUT") poolAtomic += amount;
    else if (leg.kind === "FEE_OUT") feeAtomic += amount;
  }
  return { winnerAtomic, poolAtomic, feeAtomic };
}

export function attributedFromOutflows(
  faceAtomic: bigint,
  out: ConfirmedOutflows,
  refunded: boolean,
): bigint {
  if (refunded) return BigInt(0);
  const remaining = faceAtomic - out.winnerAtomic - out.poolAtomic - out.feeAtomic;
  return remaining < BigInt(0) ? BigInt(0) : remaining;
}
