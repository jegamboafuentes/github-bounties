import { and, eq, inArray, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, claimLocks, claims, escrows, feeLedger, users } from "../db/schema";
import { FEE_BPS, POOL_BPS_OF_POST_FEE } from "../lib/constants";
import { splitFaceUsdc, splitPostFeePool, type PostFeePoolSplit } from "../lib/money";
import { EscrowError } from "./errors";
import { probeCdpEnv } from "./env";
import {
  persistEscrowFail,
  toPersistedLockFailure,
  toPersistedRailFailure,
  VOIDED_UNFUNDED_CODE,
  VOIDED_UNFUNDED_REASON,
} from "./fail";
import { hostedCheckoutStatus } from "./hosted";
import { resolveLockFundTxHash } from "./inbound";
import { moneyIdempotencyKey } from "./idempotency";
import {
  confirmedOutflowsFromLegs,
  ensurePendingLegs,
  findLedgerRow,
  legHasTxHash,
  loadAllocationLegs,
  loadFrozenSettleSet,
  markLegConfirmed,
  markLegFailed,
  markLegSubmitted,
  markPoolParticipantPaid,
  markPoolParticipantSkip,
  planSettleLegs,
  resolvePoolMemberAddress,
  voidPendingAllocationLegs,
  type PlannedLeg,
} from "./allocation";
import { resolveRail, type CdpRail } from "./rail";
import { walletConnectStatus } from "../wallet/env";
import { x402ExactStatus } from "./x402";
import { reconcileBountyNotes, type EscrowReconRow } from "./reconcile";
import {
  assertEscrowTransition,
  ESCROW_LOCKED,
  OPEN_MONEY_BOUNTY_STATUSES,
  REFUNDABLE_BOUNTY_STATUSES,
  SETTLEABLE_BOUNTY_STATUSES,
  type EscrowStatus,
} from "./state";

export type EscrowServiceOpts = {
  db: Database;
  rail?: CdpRail;
  now?: Date;
};

function railOf(opts: EscrowServiceOpts): CdpRail {
  return opts.rail ?? resolveRail();
}

async function loadBounty(db: Database, bountyId: string) {
  const [bounty] = await db.select().from(bounties).where(eq(bounties.id, bountyId)).limit(1);
  if (!bounty) {
    throw new EscrowError("bounty_not_found", "Bounty not found.");
  }
  return bounty;
}

async function loadEscrow(db: Database, bountyId: string) {
  const [row] = await db.select().from(escrows).where(eq(escrows.bountyId, bountyId)).limit(1);
  return row ?? null;
}

function toRecon(
  bountyId: string,
  faceUsdc: string,
  escrow: typeof escrows.$inferSelect,
  outflows?: { winnerAtomic: bigint; poolAtomic: bigint; feeAtomic: bigint },
): EscrowReconRow {
  return {
    bountyId,
    faceUsdc,
    escrowStatus: escrow.status,
    fundTxHash: escrow.fundTxHash,
    payoutTxHash: escrow.payoutTxHash,
    feeTxHash: escrow.feeTxHash,
    refundTxHash: escrow.refundTxHash,
    confirmedWinnerAtomic: outflows?.winnerAtomic,
    confirmedPoolAtomic: outflows?.poolAtomic,
    confirmedFeeAtomic: outflows?.feeAtomic,
  };
}

export type LockResult = {
  bountyId: string;
  escrowId: string;
  status: "funded";
  escrowStatus: "funded";
  fundedAt: Date;
  fundTxHash: string;
  escrowAddress: string;
  feeAddress: string;
  rail: CdpRail["mode"];
  network: string;
  missingEnv: string[];
  hostedCheckout: ReturnType<typeof hostedCheckoutStatus>;
  reconcile: string[];
};

/**
 * pending → locked (`escrows.status=funded`). Poster-only.
 * Mock rail records a mock fund hash and lists exact missing CDP_*.
 * Live rail requires a confirmed inbound (x402 exact record or pasted hash)
 * or CDP_DRY_RUN_LIVE faucet.
 */
export async function lockEscrowFunds(
  bountyId: string,
  actorUserId: string,
  opts: EscrowServiceOpts & { fundTxHash?: string | null; funderAddress?: string | null },
): Promise<LockResult> {
  if (!actorUserId) {
    throw new EscrowError("unauthorized", "Sign in with Google to fund a bounty.");
  }
  const now = opts.now ?? new Date();
  const bounty = await loadBounty(opts.db, bountyId);
  if (bounty.posterUserId !== actorUserId) {
    throw new EscrowError("not_poster", "Only the poster can lock escrow for this bounty.");
  }
  if (bounty.status !== "pending_fund") {
    throw new EscrowError("not_fundable", `Bounty is ${bounty.status}, not pending_fund.`);
  }

  const split = splitFaceUsdc(bounty.amountUsdc);
  const fundKey = moneyIdempotencyKey(bountyId, "FUND_IN");
  const existingBeforeLock = await loadEscrow(opts.db, bountyId);
  const fundTxHash = resolveLockFundTxHash({
    pasted: opts.fundTxHash,
    recorded: existingBeforeLock?.fundTxHash,
  });

  let rail: CdpRail;
  let locked: Awaited<ReturnType<CdpRail["lockFace"]>>;
  try {
    rail = railOf(opts);
    locked = await rail.lockFace({
      amountAtomic: split.faceAtomic,
      idempotencyKey: fundKey,
      fundTxHash,
    });
  } catch (err) {
    const failure = toPersistedLockFailure(err);
    await persistEscrowFail(opts.db, bountyId, {
      code: failure.code,
      reason: failure.reason,
      now,
    });
    throw failure.error;
  }

  const [poster] = await opts.db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, actorUserId))
    .limit(1);
  const funderAddress =
    opts.funderAddress?.trim() || poster?.walletAddress?.trim() || locked.escrowAddress;

  await opts.db.transaction(async (tx) => {
    const [updated] = await tx
      .update(bounties)
      .set({ status: "funded", fundedAt: now, updatedAt: now })
      .where(and(eq(bounties.id, bountyId), eq(bounties.status, "pending_fund")))
      .returning({ id: bounties.id });
    if (!updated) {
      throw new EscrowError("not_fundable", "Bounty is no longer pending_fund.");
    }

    const existing = await loadEscrow(tx as unknown as Database, bountyId);
    const patch = {
      status: ESCROW_LOCKED,
      amountUsdc: bounty.amountUsdc,
      fundTxHash: locked.txHash,
      escrowAddress: locked.escrowAddress,
      funderAddress,
      idempotencyKey: fundKey,
      checkoutId: existing?.checkoutId ?? null,
      x402PaymentId: existing?.x402PaymentId ?? null,
      x402Url: existing?.x402Url ?? null,
      failCode: null,
      failReason: null,
      updatedAt: now,
    };
    if (existing) {
      assertEscrowTransition(existing.status, ESCROW_LOCKED);
      await tx.update(escrows).set(patch).where(eq(escrows.id, existing.id));
    } else {
      await tx.insert(escrows).values({
        bountyId,
        ...patch,
      });
    }
  });

  const escrow = await loadEscrow(opts.db, bountyId);
  if (!escrow) throw new EscrowError("bounty_not_found", "Escrow row missing after lock.");

  return {
    bountyId,
    escrowId: escrow.id,
    status: "funded",
    escrowStatus: "funded",
    fundedAt: now,
    fundTxHash: locked.txHash,
    escrowAddress: locked.escrowAddress,
    feeAddress: locked.feeAddress,
    rail: rail.mode,
    network: rail.network,
    missingEnv: rail.missingEnv,
    hostedCheckout: hostedCheckoutStatus(),
    reconcile: reconcileBountyNotes(toRecon(bountyId, bounty.amountUsdc, escrow)),
  };
}

export type SettleResult = {
  bountyId: string;
  escrowStatus: EscrowStatus;
  bountyStatus: "settled" | "settled_partial";
  hunterUsdc: string;
  winnerUsdc: string;
  poolTotalUsdc: string;
  poolPaidCount: number;
  feeUsdc: string;
  feeBps: number;
  payoutTxHash: string | null;
  feeTxHash: string | null;
  hunterAddress: string;
  feeAddress: string;
  rail: CdpRail["mode"];
  network: string;
  missingEnv: string[];
  hostedCheckout: ReturnType<typeof hostedCheckoutStatus>;
  reconcile: string[];
};

/**
 * Persist a settle-rail throw, then rethrow. Status stays `settling` when
 * we already entered that state (ADR: no Settling → funded rollback) so Claim
 * / settle remain retryable. Never leave a hung settle without fail fields.
 */
async function persistSettleRailFail(
  db: Database,
  bountyId: string,
  err: unknown,
  now: Date,
  fallbackMessage: string,
): Promise<never> {
  const failure = toPersistedRailFailure(err, fallbackMessage);
  await persistEscrowFail(db, bountyId, {
    code: failure.code,
    reason: failure.reason,
    now,
  });
  throw failure.error;
}

/**
 * Multi-payee settle (ADR 0003 / V2-3): FEE_OUT + WINNER_PAYOUT + POOL_PAYOUT×N.
 * Empty pool is byte-for-byte the V1 winner amount (post_fee).
 *
 * Insert allocation rows before the first transfer. Retry remaining legs only.
 * Winner-leg failure before a hash stays `settling` + fail_code (V1-5).
 * Any confirmed intended leg + any unconfirmed intended leg → SettledPartial.
 */
export async function settleEscrow(
  bountyId: string,
  input: {
    actorUserId?: string;
    hunterUserId?: string;
    hunterPayoutAddress?: string | null;
    claimId?: string;
  },
  opts: EscrowServiceOpts,
): Promise<SettleResult> {
  const now = opts.now ?? new Date();
  const rail = railOf(opts);
  const bounty = await loadBounty(opts.db, bountyId);
  const escrow = await loadEscrow(opts.db, bountyId);
  const freeze = await loadFrozenSettleSet(opts.db, bountyId);
  const poolBps = bounty.participationPoolBps ?? POOL_BPS_OF_POST_FEE;
  const split = splitPostFeePool(bounty.amountUsdc, freeze.eligibleCount, FEE_BPS, poolBps);
  const unpaidPool = freeze.poolMembers.filter((row) => !row.payoutTxHash);

  if (
    (bounty.status === "settled" || escrow?.status === "settled") &&
    escrow?.payoutTxHash &&
    (escrow.feeTxHash || split.feeAtomic === BigInt(0)) &&
    unpaidPool.length === 0
  ) {
    const wallets = await rail.ensureWallets();
    const legs = await loadAllocationLegs(opts.db, bountyId);
    return finishSettleResult({
      bountyId,
      faceUsdc: bounty.amountUsdc,
      escrow,
      bountyStatus: "settled",
      rail,
      wallets,
      split,
      hunterAddress: "",
      legs,
    });
  }

  const settleable =
    SETTLEABLE_BOUNTY_STATUSES.includes(
      bounty.status as (typeof SETTLEABLE_BOUNTY_STATUSES)[number],
    ) ||
    (bounty.status === "settled" && unpaidPool.length > 0);
  if (!settleable) {
    throw new EscrowError("not_settleable", `Bounty is ${bounty.status}, not settleable.`);
  }

  if (!escrow || (escrow.status !== "funded" && escrow.status !== "settling" && escrow.status !== "settled_partial" && escrow.status !== "settled")) {
    throw new EscrowError("not_settleable", "Escrow is not locked (funded) — cannot settle.");
  }

  const hunter = await resolveHunter(opts.db, bountyId, input);
  if (input.actorUserId && input.actorUserId !== bounty.posterUserId && input.actorUserId !== hunter.userId) {
    throw new EscrowError("not_settler", "Only the poster or the winning hunter can settle.");
  }

  const wallets = await rail.ensureWallets().catch((err: unknown) =>
    persistSettleRailFail(
      opts.db,
      bountyId,
      err,
      now,
      "Settle rail failed before hunter payout.",
    ),
  );

  if (escrow.status === "funded") {
    assertEscrowTransition(escrow.status, "settling");
    await opts.db
      .update(bounties)
      .set({
        status: "settling",
        participationPoolUsdc: split.poolTotalUsdc,
        updatedAt: now,
      })
      .where(
        and(eq(bounties.id, bountyId), inArray(bounties.status, ["funded", "claim_locked"])),
      );
    await opts.db
      .update(escrows)
      .set({ status: "settling", escrowAddress: wallets.escrowAddress, updatedAt: now })
      .where(eq(escrows.id, escrow.id));
  } else if (split.poolPaidAtomic >= BigInt(0)) {
    await opts.db
      .update(bounties)
      .set({ participationPoolUsdc: split.poolTotalUsdc, updatedAt: now })
      .where(eq(bounties.id, bountyId));
  }

  const poolResolved = await Promise.all(
    freeze.poolMembers.map(async (member) => ({
      id: member.id,
      userId: member.userId,
      toAddress: await resolvePoolMemberAddress(opts.db, member),
    })),
  );

  const planned = planSettleLegs({
    bountyId,
    split,
    winnerAddress: hunter.address,
    winnerParticipantId: freeze.winner?.id ?? null,
    feeAddress: wallets.feeAddress,
    poolMembers: poolResolved,
  });

  let ledgerRows = await ensurePendingLegs(opts.db, bountyId, planned);
  ledgerRows = await syncEscrowHashesOntoLedger(opts.db, planned, ledgerRows, escrow, now);

  let payoutTxHash = escrow.payoutTxHash;
  let feeTxHash = escrow.feeTxHash;
  let lastFail: { code: string; reason: string } | null = null;

  for (const leg of planned) {
    const row = findLedgerRow(ledgerRows, leg.kind, leg.participantId);
    const existingHash =
      row?.txHash?.trim() ||
      (leg.kind === "WINNER_PAYOUT" ? payoutTxHash : null) ||
      (leg.kind === "FEE_OUT" ? feeTxHash : null);
    if (existingHash) {
      if (leg.kind === "WINNER_PAYOUT") payoutTxHash = existingHash;
      if (leg.kind === "FEE_OUT") feeTxHash = existingHash;
      continue;
    }

    if (leg.deferReason) {
      if (leg.participantId) {
        await markPoolParticipantSkip(opts.db, leg.participantId, leg.deferReason, now);
      }
      lastFail = {
        code: leg.deferReason,
        reason:
          leg.deferReason === "hunter_not_linked"
            ? "Pool member GitHub identity is not linked. Connect GitHub, then retry settle — do not redistribute."
            : "Pool member has no BYO Base payout address. Set users.wallet_address, then retry — do not redistribute.",
      };
      continue;
    }

    if (!row || !leg.toAddress) {
      continue;
    }

    await markLegSubmitted(opts.db, row.id, now);
    const idempotencyKey = row.idempotencyKey || leg.idempotencyKey;
    try {
      const sent = await rail.transferUsdc({
        to: leg.toAddress,
        amountAtomic: leg.amountAtomic,
        idempotencyKey,
        purpose: leg.purpose,
        kind: leg.railKind,
      });
      await markLegConfirmed(opts.db, {
        ledgerId: row.id,
        txHash: sent.txHash,
        toAddress: leg.toAddress,
        now,
      });
      if (leg.kind === "WINNER_PAYOUT") {
        payoutTxHash = sent.txHash;
        await opts.db
          .update(escrows)
          .set({ payoutTxHash, updatedAt: now })
          .where(eq(escrows.id, escrow.id));
        if (leg.participantId) {
          await markPoolParticipantPaid(opts.db, {
            participantId: leg.participantId,
            payoutAddress: leg.toAddress,
            payoutTxHash: sent.txHash,
            now,
          });
        }
      } else if (leg.kind === "FEE_OUT") {
        feeTxHash = sent.txHash;
        await opts.db
          .update(escrows)
          .set({ feeTxHash, updatedAt: now })
          .where(eq(escrows.id, escrow.id));
      } else if (leg.kind === "POOL_PAYOUT" && leg.participantId) {
        await markPoolParticipantPaid(opts.db, {
          participantId: leg.participantId,
          payoutAddress: leg.toAddress,
          payoutTxHash: sent.txHash,
          now,
        });
      }
    } catch (err) {
      await markLegFailed(opts.db, row.id, now);
      if (leg.kind === "WINNER_PAYOUT") {
        await persistSettleRailFail(
          opts.db,
          bountyId,
          err,
          now,
          "Hunter payout transfer failed.",
        );
      }
      const failure = toPersistedRailFailure(
        err,
        leg.kind === "FEE_OUT" ? "Fee transfer failed." : "Pool payout transfer failed.",
      );
      lastFail = { code: failure.code, reason: failure.reason };
      await persistEscrowFail(opts.db, bountyId, {
        code: failure.code,
        reason: failure.reason,
        now,
      });
    }
  }

  ledgerRows = await loadAllocationLegs(opts.db, bountyId);
  const intendedConfirmed = planned.every((leg) => {
    const row = findLedgerRow(ledgerRows, leg.kind, leg.participantId);
    if (legHasTxHash(row)) return true;
    if (leg.kind === "WINNER_PAYOUT" && payoutTxHash) return true;
    if (leg.kind === "FEE_OUT" && (feeTxHash || split.feeAtomic === BigInt(0))) return true;
    return false;
  });
  const anyConfirmed = planned.some((leg) => {
    const row = findLedgerRow(ledgerRows, leg.kind, leg.participantId);
    return (
      legHasTxHash(row) ||
      (leg.kind === "WINNER_PAYOUT" && Boolean(payoutTxHash)) ||
      (leg.kind === "FEE_OUT" && Boolean(feeTxHash))
    );
  });

  const terminal: "settled" | "settled_partial" = intendedConfirmed
    ? "settled"
    : anyConfirmed
      ? "settled_partial"
      : "settled_partial";

  await opts.db.transaction(async (tx) => {
    await tx
      .update(escrows)
      .set({
        status: terminal,
        payoutTxHash,
        feeTxHash,
        escrowAddress: wallets.escrowAddress,
        failCode: terminal === "settled" ? null : lastFail?.code ?? escrow.failCode,
        failReason: terminal === "settled" ? null : lastFail?.reason ?? escrow.failReason,
        updatedAt: now,
      })
      .where(eq(escrows.id, escrow.id));
    await tx
      .update(bounties)
      .set({
        status: terminal,
        participationPoolUsdc: split.poolTotalUsdc,
        updatedAt: now,
      })
      .where(eq(bounties.id, bountyId));

    if (terminal === "settled") {
      await tx
        .insert(feeLedger)
        .values({
          bountyId,
          faceUsdc: split.faceUsdc,
          feeUsdc: split.feeUsdc,
          feeBps: FEE_BPS,
          settledAt: now,
        })
        .onConflictDoUpdate({
          target: feeLedger.bountyId,
          set: {
            faceUsdc: split.faceUsdc,
            feeUsdc: split.feeUsdc,
            feeBps: FEE_BPS,
            settledAt: now,
          },
        });

      if (hunter.claimId) {
        await tx
          .update(claims)
          .set({
            status: "paid",
            payoutAddress: hunter.address,
            payoutUsdc: split.winnerUsdc,
            payoutTxHash,
            paidAt: now,
            updatedAt: now,
          })
          .where(eq(claims.id, hunter.claimId));
      }

      await tx
        .update(claimLocks)
        .set({ status: "consumed", updatedAt: now })
        .where(and(eq(claimLocks.bountyId, bountyId), eq(claimLocks.status, "active")));
    }
  });

  const latest = await loadEscrow(opts.db, bountyId);
  if (!latest) throw new EscrowError("bounty_not_found", "Escrow missing after settle.");
  const result = finishSettleResult({
    bountyId,
    faceUsdc: bounty.amountUsdc,
    escrow: latest,
    bountyStatus: terminal,
    rail,
    wallets,
    split,
    hunterAddress: hunter.address,
    legs: ledgerRows,
  });
  return result;
}

async function syncEscrowHashesOntoLedger(
  db: Database,
  planned: readonly PlannedLeg[],
  rows: Awaited<ReturnType<typeof loadAllocationLegs>>,
  escrow: typeof escrows.$inferSelect,
  now: Date,
): Promise<Awaited<ReturnType<typeof loadAllocationLegs>>> {
  for (const leg of planned) {
    const row = findLedgerRow(rows, leg.kind, leg.participantId);
    if (!row || row.txHash) continue;
    const hash =
      leg.kind === "WINNER_PAYOUT"
        ? escrow.payoutTxHash
        : leg.kind === "FEE_OUT"
          ? escrow.feeTxHash
          : null;
    if (!hash) continue;
    await markLegConfirmed(db, {
      ledgerId: row.id,
      txHash: hash,
      toAddress: leg.toAddress,
      now,
    });
  }
  return loadAllocationLegs(db, escrow.bountyId);
}

function finishSettleResult(args: {
  bountyId: string;
  faceUsdc: string;
  escrow: typeof escrows.$inferSelect;
  bountyStatus: "settled" | "settled_partial";
  rail: CdpRail;
  wallets: { escrowAddress: string; feeAddress: string };
  split: PostFeePoolSplit;
  hunterAddress: string;
  legs: Awaited<ReturnType<typeof loadAllocationLegs>>;
}): SettleResult {
  const out = confirmedOutflowsFromLegs(args.legs);
  return {
    bountyId: args.bountyId,
    escrowStatus: args.escrow.status,
    bountyStatus: args.bountyStatus,
    hunterUsdc: args.split.winnerUsdc,
    winnerUsdc: args.split.winnerUsdc,
    poolTotalUsdc: args.split.poolTotalUsdc,
    poolPaidCount: args.split.paidCount,
    feeUsdc: args.split.feeUsdc,
    feeBps: args.split.feeBps,
    payoutTxHash: args.escrow.payoutTxHash,
    feeTxHash: args.escrow.feeTxHash,
    hunterAddress: args.hunterAddress,
    feeAddress: args.wallets.feeAddress,
    rail: args.rail.mode,
    network: args.rail.network,
    missingEnv: args.rail.missingEnv,
    hostedCheckout: hostedCheckoutStatus(),
    reconcile: reconcileBountyNotes(toRecon(args.bountyId, args.faceUsdc, args.escrow, out)),
  };
}

async function resolveHunter(
  db: Database,
  bountyId: string,
  input: {
    hunterUserId?: string;
    hunterPayoutAddress?: string | null;
    claimId?: string;
  },
): Promise<{ userId: string; address: string; claimId?: string }> {
  if (input.claimId) {
    const [claim] = await db.select().from(claims).where(eq(claims.id, input.claimId)).limit(1);
    if (claim && claim.bountyId === bountyId) {
      const address =
        input.hunterPayoutAddress?.trim() ||
        claim.payoutAddress?.trim() ||
        (await walletOf(db, claim.hunterUserId));
      if (!address) {
        throw new EscrowError(
          "missing_payout_address",
          "Hunter payout address is required to settle. Set users.wallet_address or claims.payout_address.",
        );
      }
      return { userId: claim.hunterUserId, address, claimId: claim.id };
    }
  }

  const [eligible] = await db
    .select()
    .from(claims)
    .where(and(eq(claims.bountyId, bountyId), eq(claims.status, "eligible")))
    .limit(1);

  const hunterUserId = input.hunterUserId || eligible?.hunterUserId;
  if (!hunterUserId) {
    const address = input.hunterPayoutAddress?.trim();
    if (!address) {
      throw new EscrowError(
        "missing_payout_address",
        "No eligible claim and no hunter payout address. Pass hunterPayoutAddress for the minimal settle API.",
      );
    }
    return { userId: "00000000-0000-4000-8000-000000000000", address };
  }

  const address =
    input.hunterPayoutAddress?.trim() ||
    eligible?.payoutAddress?.trim() ||
    (await walletOf(db, hunterUserId));
  if (!address) {
    throw new EscrowError(
      "missing_payout_address",
      "Hunter payout address is required to settle. Set users.wallet_address or pass hunterPayoutAddress.",
    );
  }
  return { userId: hunterUserId, address, claimId: eligible?.id };
}

async function walletOf(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.walletAddress?.trim() || null;
}

export type RefundResult = {
  bountyId: string;
  escrowStatus: EscrowStatus | "failed";
  bountyStatus: "cancelled" | "expired" | "refunded";
  refundTxHash: string | null;
  rail: CdpRail["mode"];
  network: string;
  missingEnv: string[];
  hostedCheckout: ReturnType<typeof hostedCheckoutStatus>;
  reconcile: string[];
};

/**
 * Full-face refund. No fee. Poster cancel or bounty expiry (unmerged).
 * Claim-lock expiry does **not** refund — that only restores `funded`.
 */
export async function refundEscrow(
  bountyId: string,
  input: {
    actorUserId?: string;
    reason: "cancel" | "expiry";
    funderAddress?: string | null;
  },
  opts: EscrowServiceOpts,
): Promise<RefundResult> {
  const now = opts.now ?? new Date();
  const rail = railOf(opts);
  const bounty = await loadBounty(opts.db, bountyId);

  if (bounty.status === "pending_fund") {
    if (input.actorUserId && input.actorUserId !== bounty.posterUserId) {
      throw new EscrowError("not_poster", "Only the poster can cancel this bounty.");
    }
    await opts.db.transaction(async (tx) => {
      await tx
        .update(bounties)
        .set({
          status: input.reason === "expiry" ? "expired" : "cancelled",
          updatedAt: now,
        })
        .where(eq(bounties.id, bountyId));
      const existing = await loadEscrow(tx as unknown as Database, bountyId);
      if (existing && existing.status === "pending") {
        await tx
          .update(escrows)
          .set({
            status: "failed",
            // Keep the last Lock rail reason if present (dogfood: cancel after inbound_unconfirmed).
            failCode: existing.failCode ?? VOIDED_UNFUNDED_CODE,
            failReason: existing.failReason ?? VOIDED_UNFUNDED_REASON,
            updatedAt: now,
          })
          .where(eq(escrows.id, existing.id));
      }
    });
    return {
      bountyId,
      escrowStatus: "failed",
      bountyStatus: input.reason === "expiry" ? "expired" : "cancelled",
      refundTxHash: null,
      rail: rail.mode,
      network: rail.network,
      missingEnv: rail.missingEnv,
      hostedCheckout: hostedCheckoutStatus(),
      reconcile: [
        "No FUND_IN confirmed — cancel/expiry voids the draft. No USDC movement.",
      ],
    };
  }

  if (bounty.status === "refunded" || bounty.status === "cancelled" || bounty.status === "expired") {
    const existing = await loadEscrow(opts.db, bountyId);
    return {
      bountyId,
      escrowStatus: existing?.status ?? "refunded",
      bountyStatus: bounty.status === "expired" ? "expired" : bounty.status === "cancelled" ? "cancelled" : "refunded",
      refundTxHash: existing?.refundTxHash ?? null,
      rail: rail.mode,
      network: rail.network,
      missingEnv: rail.missingEnv,
      hostedCheckout: hostedCheckoutStatus(),
      reconcile: existing
        ? reconcileBountyNotes(toRecon(bountyId, bounty.amountUsdc, existing))
        : ["already terminal"],
    };
  }

  if (
    !REFUNDABLE_BOUNTY_STATUSES.includes(
      bounty.status as (typeof REFUNDABLE_BOUNTY_STATUSES)[number],
    )
  ) {
    throw new EscrowError("not_refundable", `Bounty is ${bounty.status}, not refundable.`);
  }
  if (input.reason === "cancel" && input.actorUserId && input.actorUserId !== bounty.posterUserId) {
    throw new EscrowError("not_poster", "Only the poster can cancel and refund this bounty.");
  }

  const escrow = await loadEscrow(opts.db, bountyId);
  if (!escrow) {
    throw new EscrowError("not_refundable", "Escrow row missing — cannot refund.");
  }
  if (escrow.refundTxHash && escrow.status === "refunded") {
    return {
      bountyId,
      escrowStatus: "refunded",
      bountyStatus: input.reason === "expiry" ? "expired" : "cancelled",
      refundTxHash: escrow.refundTxHash,
      rail: rail.mode,
      network: rail.network,
      missingEnv: rail.missingEnv,
      hostedCheckout: hostedCheckoutStatus(),
      reconcile: reconcileBountyNotes(toRecon(bountyId, bounty.amountUsdc, escrow)),
    };
  }

  const wallets = await rail.ensureWallets();
  const funderAddress =
    input.funderAddress?.trim() ||
    escrow.funderAddress?.trim() ||
    (await walletOf(opts.db, bounty.posterUserId));
  if (!funderAddress) {
    throw new EscrowError(
      "missing_funder_address",
      "Funder address is required to refund face F. Set users.wallet_address or escrows.funder_address.",
    );
  }

  const split = splitFaceUsdc(bounty.amountUsdc);
  const refundKey = moneyIdempotencyKey(bountyId, "REFUND_OUT");

  assertEscrowTransition(escrow.status === "refunding" ? "refunding" : "funded", "refunding");
  await opts.db
    .update(bounties)
    .set({ status: "refunding", updatedAt: now })
    .where(eq(bounties.id, bountyId));
  await opts.db
    .update(escrows)
    .set({ status: "refunding", funderAddress, updatedAt: now })
    .where(eq(escrows.id, escrow.id));

  const sent = await rail.transferUsdc({
    to: funderAddress,
    amountAtomic: split.faceAtomic,
    idempotencyKey: refundKey,
    purpose: "refund",
    kind: "REFUND_OUT",
  });

  const bountyTerminal = input.reason === "expiry" ? "expired" : "cancelled";
  await opts.db.transaction(async (tx) => {
    await tx
      .update(escrows)
      .set({
        status: "refunded",
        refundTxHash: sent.txHash,
        funderAddress,
        escrowAddress: wallets.escrowAddress,
        updatedAt: now,
      })
      .where(eq(escrows.id, escrow.id));
    await tx
      .update(bounties)
      .set({ status: bountyTerminal, updatedAt: now })
      .where(eq(bounties.id, bountyId));
    await tx
      .update(claimLocks)
      .set({ status: "released", updatedAt: now })
      .where(and(eq(claimLocks.bountyId, bountyId), eq(claimLocks.status, "active")));
    await voidPendingAllocationLegs(tx as unknown as Database, bountyId, now);
  });

  const latest = await loadEscrow(opts.db, bountyId);
  return {
    bountyId,
    escrowStatus: latest?.status ?? "refunded",
    bountyStatus: bountyTerminal,
    refundTxHash: sent.txHash,
    rail: rail.mode,
    network: rail.network,
    missingEnv: rail.missingEnv,
    hostedCheckout: hostedCheckoutStatus(),
    reconcile: latest
      ? reconcileBountyNotes(toRecon(bountyId, bounty.amountUsdc, latest))
      : [],
  };
}

export type ExpireBountiesResult = {
  refundedBountyIds: string[];
  voidedBountyIds: string[];
  errors: { bountyId: string; message: string }[];
};

/**
 * Honor `bounties.expires_at` when set (unmerged). No default TTL —
 * claim-lock expiry is coordination only and does not move USDC.
 */
export async function expireUnmergedBounties(
  opts: EscrowServiceOpts,
): Promise<ExpireBountiesResult> {
  const now = opts.now ?? new Date();
  const due = await opts.db
    .select({ id: bounties.id, status: bounties.status })
    .from(bounties)
    .where(
      and(
        lte(bounties.expiresAt, now),
        inArray(bounties.status, [...OPEN_MONEY_BOUNTY_STATUSES, "pending_fund", "refunding"]),
      ),
    );

  const refundedBountyIds: string[] = [];
  const voidedBountyIds: string[] = [];
  const errors: { bountyId: string; message: string }[] = [];

  for (const row of due) {
    try {
      const result = await refundEscrow(row.id, { reason: "expiry" }, { ...opts, now });
      if (result.refundTxHash) refundedBountyIds.push(row.id);
      else voidedBountyIds.push(row.id);
    } catch (err) {
      errors.push({
        bountyId: row.id,
        message: err instanceof Error ? err.message : "refund failed",
      });
    }
  }

  return { refundedBountyIds, voidedBountyIds, errors };
}

export function escrowHealth(env = process.env) {
  const probe = probeCdpEnv(env);
  return {
    wired: true,
    ticket: "V2-3",
    network: probe.network,
    rail: probe.mode,
    missing: probe.missing,
    hosted_checkout: hostedCheckoutStatus(),
    x402_exact: x402ExactStatus(env),
    walletconnect: walletConnectStatus(env),
    mainnet_refused: probe.unsafeNetwork && !probe.mainnetAllowed,
    fee_bps: FEE_BPS,
    wallets: { escrow: "gb-escrow", fee: "gb-fee" },
  };
}
