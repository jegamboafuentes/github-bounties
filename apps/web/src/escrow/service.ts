import { and, eq, inArray, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, claimLocks, claims, escrows, feeLedger, githubLinks, users } from "../db/schema";
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
import { assertCallerLockHash, assertFundTxHashAvailable, normalizeFundTxHash } from "./fund-hash";
import { resolveLockFundTxHash } from "./inbound";
import { logMoneyAction, moneyResultCode, takeRequestId, type MoneyAction } from "./actor-log";
import { payerDistinctFromEscrow, transferToStoredDestination } from "./destination-guard";
import { createLegacyChainReader, reconcileLegacyFunding, type LegacyChainReader } from "./legacy-funding";
import { requireBasePayoutAddress } from "./payout-address";
import { assertPayoutCovered, loadPayoutCoverage } from "./payout-guard";
import { coverageDecision, executeCoveredLegs, type CoverageLeg, type PayoutLegReport } from "./payout-legs";
import { moneyIdempotencyKey } from "./idempotency";
import {
  confirmedOutflowsFromLegs,
  ensurePendingLegs,
  findLedgerRow,
  isExpectedPoolDefer,
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
  shouldTransferLeg,
  voidPendingAllocationLegs,
  type PlannedLeg,
  type SettleScope,
} from "./allocation";
import { resolveRail, type CdpRail, type RailWallets } from "./rail";
import { notifyAfterWinnerPayout, notifyBountyFunded, type DomainEmailDeps } from "../email/events";
import { walletConnectStatus } from "../wallet/env";
import {
  contributionRefundPlan,
  markContributionRefunded,
  recordLockContribution,
  type ContributionRefundLeg,
} from "./top-up";
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
  /** Optional. Production uses process.env. Missing RESEND_API_KEY does not fail the money call. */
  email?: DomainEmailDeps;
  /** Correlates Cloud Logging lines for one HTTP request or server action. */
  requestId?: string | null;
  /** API key that started the call. Website and webhook actions leave this unset. */
  apiKeyId?: string | null;
  /** Overrides the Base JSON-RPC reader used to count legacy funding. Tests inject this. */
  legacyChain?: LegacyChainReader;
};

async function coverageAfterLegacy(
  opts: EscrowServiceOpts,
  bountyId: string,
  railMode: CdpRail["mode"],
) {
  if (railMode === "cdp") {
    await reconcileLegacyFunding(
      opts.db,
      bountyId,
      opts.legacyChain ?? createLegacyChainReader(),
    );
  }
  return loadPayoutCoverage(opts.db, bountyId, railMode);
}

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
 * Mock rail records a mock fund hash (or a pasted hash) and lists exact missing CDP_*.
 * Live rail requires the x402 settle hash already recorded for this bounty,
 * or CDP_DRY_RUN_LIVE faucet. A pasted hash that is not that record is rejected.
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
    if (bounty.status === "funded") {
      await notifyBountyFunded(opts.db, bountyId, opts.email);
    }
    throw new EscrowError("not_fundable", `Bounty is ${bounty.status}, not pending_fund.`);
  }

  const split = splitFaceUsdc(bounty.amountUsdc);
  const fundKey = moneyIdempotencyKey(bountyId, "FUND_IN");
  const existingBeforeLock = await loadEscrow(opts.db, bountyId);
  const requestId = takeRequestId(opts.requestId);

  let rail: CdpRail;
  let locked: Awaited<ReturnType<CdpRail["lockFace"]>>;
  try {
    rail = railOf(opts);
    const recordedByX402 = Boolean(existingBeforeLock?.x402PaymentId?.trim());
    await assertCallerLockHash(opts.db, bountyId, opts.fundTxHash, rail.mode);
    const fundTxHash = resolveLockFundTxHash({
      pasted: opts.fundTxHash,
      recorded: existingBeforeLock?.fundTxHash,
      railMode: rail.mode,
      recordedByX402,
    });
    if (fundTxHash) {
      await assertFundTxHashAvailable(opts.db, fundTxHash, bountyId);
    }
    locked = await rail.lockFace({
      amountAtomic: split.faceAtomic,
      idempotencyKey: fundKey,
      fundTxHash,
      verifiedInbound: rail.mode === "cdp" && recordedByX402 && Boolean(fundTxHash),
    });
    const lockedHash = normalizeFundTxHash(locked.txHash);
    const requestedHash = fundTxHash ? normalizeFundTxHash(fundTxHash) : "";
    if (lockedHash && lockedHash !== requestedHash) {
      await assertFundTxHashAvailable(opts.db, lockedHash, bountyId);
    }
  } catch (err) {
    const failure = toPersistedLockFailure(err);
    await persistEscrowFail(opts.db, bountyId, {
      code: failure.code,
      reason: failure.reason,
      now,
    });
    logMoneyAction({
      action: "lock",
      actorUserId,
      bountyId,
      payer: null,
      amountUsdc: bounty.amountUsdc,
      txHash: null,
      result: failure.code,
      requestId,
    });
    throw failure.error;
  }

  const [poster] = await opts.db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, actorUserId))
    .limit(1);
  // PROD bug (bounty bbcc9ee5): Lock used `poster wallet || escrow address`
  // and overwrote the x402 sender with payTo (gb-escrow). Keep the verified
  // x402 payer. Never store the escrow wallet, and never a caller address.
  const escrowWallet = existingBeforeLock?.escrowAddress || locked.escrowAddress;
  const x402Payer = payerDistinctFromEscrow(existingBeforeLock?.funderAddress, escrowWallet);
  const posterWallet = payerDistinctFromEscrow(poster?.walletAddress, locked.escrowAddress);
  const funderAddress = x402Payer || posterWallet || null;
  if (rail.mode === "cdp" && Boolean(existingBeforeLock?.x402PaymentId?.trim()) && !x402Payer) {
    logMoneyAction({
      action: "lock",
      actorUserId,
      bountyId,
      payer: null,
      amountUsdc: bounty.amountUsdc,
      txHash: normalizeFundTxHash(locked.txHash),
      result: "x402_settle_failed",
      requestId,
    });
    throw new EscrowError(
      "x402_settle_failed",
      "x402 settle did not record the sending wallet. Lock will not store the escrow wallet as the funder.",
    );
  }

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
      fundTxHash: normalizeFundTxHash(locked.txHash),
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

    await recordLockContribution(tx as unknown as Database, {
      bountyId,
      funderUserId: actorUserId,
      amountUsdc: bounty.amountUsdc,
      fundTxHash: normalizeFundTxHash(locked.txHash),
      funderAddress,
      now,
    });
  });

  const escrow = await loadEscrow(opts.db, bountyId);
  if (!escrow) throw new EscrowError("bounty_not_found", "Escrow row missing after lock.");

  await notifyBountyFunded(opts.db, bountyId, opts.email);

  logMoneyAction({
    action: "lock",
    actorUserId,
    bountyId,
    payer: funderAddress,
    amountUsdc: bounty.amountUsdc,
    txHash: normalizeFundTxHash(locked.txHash),
    result: "ok",
    requestId,
  });

  return {
    bountyId,
    escrowId: escrow.id,
    status: "funded",
    escrowStatus: "funded",
    fundedAt: now,
    fundTxHash: normalizeFundTxHash(locked.txHash),
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
  /** Every planned settle leg, including ones this call did not transfer. */
  legs: PayoutLegReport[];
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
 * Multi-payee settle (ADR 0003 / V2-3): intended legs stay FEE_OUT +
 * WINNER_PAYOUT + POOL_PAYOUT×N. Empty pool is the V1 winner amount (post_fee).
 *
 * Winner Claim (`scope=winner_and_fee`, default) transfers only fee + winner.
 * Pool members Claim their own `POOL_PAYOUT` later (`scope=pool_member`).
 * `scope=all` is the V2-3 ops retry that pays remaining wallets in one go.
 *
 * Insert allocation rows before the first transfer. Retry remaining legs only.
 * Winner-leg failure before a hash stays `settling` + fail_code (V1-5).
 * Winner+fee confirmed and any pool leg still pending → SettledPartial
 * ("Winner paid — pool pending"). Missing pool wallets are not a rail fail.
 */
export async function settleEscrow(
  bountyId: string,
  input: {
    actorUserId?: string;
    /**
     * Optional eligible-claim id from the hunter's own Claim.
     * Hunter user id and payout address are never taken from the caller.
     */
    claimId?: string;
    scope?: SettleScope;
    participantId?: string | null;
    /**
     * Ignored. Pool Claim writes the member's address onto the participant
     * row first. The transfer re-reads that row or the member's saved wallet.
     */
    poolPayoutAddress?: string | null;
  },
  opts: EscrowServiceOpts,
): Promise<SettleResult> {
  const now = opts.now ?? new Date();
  const scope: SettleScope = input.scope ?? "winner_and_fee";
  const requestId = takeRequestId(opts.requestId);
  const rail = railOf(opts);
  const bounty = await loadBounty(opts.db, bountyId);
  const escrow = await loadEscrow(opts.db, bountyId);
  const freeze = await loadFrozenSettleSet(opts.db, bountyId);
  const poolBps = bounty.participationPoolBps ?? POOL_BPS_OF_POST_FEE;
  const split = splitPostFeePool(bounty.amountUsdc, freeze.eligibleCount, FEE_BPS, poolBps);
  const unpaidPool = freeze.poolMembers.filter((row) => !row.payoutTxHash);

  // Settler rule before the idempotent return. A fully settled bounty used to
  // answer 200 ok:true to every signed-in user, including a funder who is
  // neither the poster nor the winning hunter.
  await assertSettleAuthorized(opts.db, bounty, bountyId, scope, input, freeze, requestId);

  if (
    (bounty.status === "settled" || escrow?.status === "settled") &&
    escrow?.payoutTxHash &&
    (escrow.feeTxHash || split.feeAtomic === BigInt(0)) &&
    unpaidPool.length === 0
  ) {
    const wallets = await rail.ensureWallets();
    const legs = await loadAllocationLegs(opts.db, bountyId);
    const result = finishSettleResult({
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
    await notifyAfterWinnerPayout(opts.db, bountyId, opts.email);
    return result;
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

  let hunter: { userId: string; address: string; claimId: string };
  try {
    hunter = await resolveHunter(opts.db, bountyId, input);
  } catch (err) {
    logMoneyAction({
      action: scope === "pool_member" ? "pool_claim" : "settle",
      actorUserId: input.actorUserId ?? null,
      bountyId,
      claimId: input.claimId ?? null,
      destination: null,
      amountUsdc: bounty.amountUsdc,
      txHash: null,
      result: moneyResultCode(err),
      requestId,
    });
    throw err;
  }
  if (scope === "pool_member") {
    if (!escrow.payoutTxHash) {
      throw new EscrowError(
        "not_settleable",
        "Winner must claim first. Pool shares stay reserved until the winner payout confirms.",
      );
    }
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

  // Sum of every remaining leg in this operation, before any status change or transfer.
  const coverage = await coverageAfterLegacy(opts, bountyId, rail.mode);
  const operationLegs: CoverageLeg[] = [];
  for (const leg of planned) {
    if (!shouldTransferLeg(leg, scope, input.participantId)) continue;
    if (leg.deferReason || !leg.toAddress || leg.amountAtomic <= BigInt(0)) continue;
    const recorded =
      (leg.kind === "WINNER_PAYOUT" ? escrow.payoutTxHash : null) ||
      (leg.kind === "FEE_OUT" ? escrow.feeTxHash : null) ||
      (leg.kind === "POOL_PAYOUT"
        ? (freeze.poolMembers.find((row) => row.id === leg.participantId)?.payoutTxHash ?? null)
        : null);
    const destination =
      leg.kind === "FEE_OUT" ? leg.toAddress : requireBasePayoutAddress(leg.toAddress);
    operationLegs.push({
      destination,
      amount: leg.amountUsdc,
      amountAtomic: leg.amountAtomic,
      kind: leg.kind,
      txHash: recorded?.trim() || null,
    });
  }
  const covered = coverageDecision({
    bountyId,
    verifiedAtomic: coverage.verifiedAtomic,
    paidAtomic: coverage.paidAtomic,
    railMode: rail.mode,
    legs: operationLegs,
  });
  if (!covered.ok) throw covered.error;

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

    if (!shouldTransferLeg(leg, scope, input.participantId)) {
      continue;
    }

    if (leg.deferReason) {
      if (leg.participantId) {
        await markPoolParticipantSkip(opts.db, leg.participantId, leg.deferReason, now);
      }
      if (scope === "pool_member") {
        throw new EscrowError(
          "missing_payout_address",
          leg.deferReason === "hunter_not_linked"
            ? "Connect GitHub as this pool login before claiming the frozen share."
            : "A BYO Base payout address is required to claim this pool share.",
        );
      }
      if (!isExpectedPoolDefer(leg.deferReason)) {
        lastFail = {
          code: leg.deferReason,
          reason: "Pool payout deferred. Retry remaining legs — do not redistribute.",
        };
      }
      continue;
    }

    if (!row || !leg.toAddress) {
      continue;
    }

    const toAddress =
      leg.kind === "FEE_OUT" ? leg.toAddress : requireBasePayoutAddress(leg.toAddress);
    await assertPayoutCovered(opts.db, bountyId, leg.amountAtomic, rail.mode);

    await markLegSubmitted(opts.db, row.id, now);
    const idempotencyKey = row.idempotencyKey || leg.idempotencyKey;
    const legAction = settleLegAction(leg.kind, scope, input.actorUserId, hunter.userId);
    try {
      const sent = await transferToStoredDestination({
        db: opts.db,
        bountyId,
        to: toAddress,
        kind: leg.kind,
        claimId: hunter.claimId,
        participantId: leg.participantId,
        rail,
        amountAtomic: leg.amountAtomic,
        idempotencyKey,
        purpose: leg.purpose,
        railKind: leg.railKind,
      });
      logMoneyAction({
        action: legAction,
        actorUserId: input.actorUserId ?? null,
        bountyId,
        claimId: leg.kind === "WINNER_PAYOUT" ? hunter.claimId : null,
        destination: toAddress,
        amountUsdc: leg.amountUsdc,
        txHash: sent.txHash,
        result: "ok",
        requestId,
        apiKeyId: opts.apiKeyId ?? null,
        leg: leg.kind,
      });
      await markLegConfirmed(opts.db, {
        ledgerId: row.id,
        txHash: sent.txHash,
        toAddress,
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
            payoutAddress: toAddress,
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
          payoutAddress: toAddress,
          payoutTxHash: sent.txHash,
          now,
        });
      }
    } catch (err) {
      logMoneyAction({
        action: legAction,
        actorUserId: input.actorUserId ?? null,
        bountyId,
        claimId: leg.kind === "WINNER_PAYOUT" ? hunter.claimId : null,
        destination: toAddress,
        amountUsdc: leg.amountUsdc,
        txHash: null,
        result: moneyResultCode(err),
        requestId,
        apiKeyId: opts.apiKeyId ?? null,
        leg: leg.kind,
      });
      await markLegFailed(opts.db, row.id, now);
      if (leg.kind === "WINNER_PAYOUT") {
        const failure = toPersistedRailFailure(err, "Hunter payout transfer failed.");
        await persistEscrowFail(opts.db, bountyId, {
          code: failure.code,
          reason: failure.reason,
          now,
        });
        const snapshot = await loadAllocationLegs(opts.db, bountyId);
        throw new EscrowError(failure.error.code, failure.reason, {
          details: {
            ...(failure.error.details ?? {}),
            legs: snapshot.map((row) => ({
              destination: row.toAddress,
              amount: row.amountUsdc,
              kind: row.kind,
              status: row.txHash?.trim() ? "paid" : row.status === "failed" ? "failed" : "pending",
              txHash: row.txHash,
              reason: row.status === "failed" ? failure.reason : null,
            })),
          },
        });
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

  const winnerAndFeeConfirmed =
    Boolean(payoutTxHash) && (Boolean(feeTxHash) || split.feeAtomic === BigInt(0));
  const railFail = lastFail && !isExpectedPoolDefer(lastFail.code) ? lastFail : null;
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
        failCode: terminal === "settled" || (winnerAndFeeConfirmed && !railFail)
          ? null
          : railFail?.code ?? escrow.failCode,
        failReason: terminal === "settled" || (winnerAndFeeConfirmed && !railFail)
          ? null
          : railFail?.reason ?? escrow.failReason,
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

    if (winnerAndFeeConfirmed) {
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
  await notifyAfterWinnerPayout(opts.db, bountyId, opts.email);
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
    legs: args.legs.map((row) => ({
      destination: row.toAddress,
      amount: row.amountUsdc,
      kind: row.kind,
      status: row.txHash?.trim() ? "paid" : row.status === "failed" ? "failed" : "pending",
      txHash: row.txHash,
      reason: row.status === "failed" ? "transfer failed" : null,
    })),
  };
}

function settleLegAction(
  kind: PlannedLeg["kind"],
  scope: SettleScope,
  actorUserId: string | undefined,
  hunterUserId: string,
): MoneyAction {
  if (kind === "FEE_OUT") return "fee_transfer";
  if (kind === "POOL_PAYOUT") return "pool_claim";
  if (kind === "WINNER_PAYOUT" && actorUserId && actorUserId === hunterUserId && scope !== "all") {
    return "winner_claim";
  }
  return "settle";
}

/**
 * Poster or the winning hunter (winner/fee/all), or the frozen pool member.
 * Runs before the idempotent settled return so a funder-only user gets
 * `not_settler` on every bounty state, including one that is already settled.
 * Missing `actorUserId` stays allowed for internal retries, same as before.
 */
async function assertSettleAuthorized(
  db: Database,
  bounty: { posterUserId: string; amountUsdc: string },
  bountyId: string,
  scope: SettleScope,
  input: {
    actorUserId?: string;
    claimId?: string;
    participantId?: string | null;
  },
  freeze: Awaited<ReturnType<typeof loadFrozenSettleSet>>,
  requestId: string,
): Promise<void> {
  if (scope === "pool_member") {
    await assertPoolMemberActor(db, freeze, input);
    return;
  }
  if (!input.actorUserId || input.actorUserId === bounty.posterUserId) return;

  let winnerUserId: string | null = null;
  let claimId: string | null = input.claimId ?? null;
  try {
    const claim = await loadSettleClaim(db, bountyId, input.claimId);
    winnerUserId = claim.hunterUserId;
    claimId = claim.id;
  } catch {
    winnerUserId = null;
  }
  if (input.actorUserId !== winnerUserId) {
    logMoneyAction({
      action: "settle",
      actorUserId: input.actorUserId,
      bountyId,
      claimId,
      destination: null,
      amountUsdc: bounty.amountUsdc,
      txHash: null,
      result: "not_settler",
      requestId,
    });
    throw new EscrowError("not_settler", "Only the poster or the winning hunter can settle.");
  }
}

/**
 * Winner identity and address come only from the GitHub merge claim.
 * Caller hunterUserId / hunterPayoutAddress are not arguments and cannot override.
 */
async function resolveHunter(
  db: Database,
  bountyId: string,
  input: { claimId?: string },
): Promise<{ userId: string; address: string; claimId: string }> {
  const claim = await loadSettleClaim(db, bountyId, input.claimId);
  const raw =
    claim.payoutAddress?.trim() || (await walletOf(db, claim.hunterUserId));
  if (!raw) {
    throw new EscrowError(
      "missing_payout_address",
      "Hunter payout address is required to settle. The winner sets it on their own Claim (claims.payout_address or their saved wallet).",
    );
  }
  const address = requireBasePayoutAddress(raw);
  return { userId: claim.hunterUserId, address, claimId: claim.id };
}

async function loadSettleClaim(
  db: Database,
  bountyId: string,
  claimId?: string,
): Promise<typeof claims.$inferSelect> {
  if (claimId) {
    const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
    if (!claim || claim.bountyId !== bountyId || (claim.status !== "eligible" && claim.status !== "paid")) {
      throw new EscrowError(
        "not_settleable",
        "Settle requires the eligible claim from the merged pull request. A caller cannot choose the hunter or the payout address.",
      );
    }
    return claim;
  }

  const [eligible] = await db
    .select()
    .from(claims)
    .where(and(eq(claims.bountyId, bountyId), eq(claims.status, "eligible")))
    .limit(1);
  if (eligible) return eligible;

  const [paid] = await db
    .select()
    .from(claims)
    .where(and(eq(claims.bountyId, bountyId), eq(claims.status, "paid")))
    .limit(1);
  if (paid) return paid;

  throw new EscrowError(
    "not_settleable",
    "No eligible claim from the GitHub merge flow. Settle will not pay an arbitrary address.",
  );
}

async function assertPoolMemberActor(
  db: Database,
  freeze: Awaited<ReturnType<typeof loadFrozenSettleSet>>,
  input: { actorUserId?: string; participantId?: string | null },
): Promise<void> {
  const member = freeze.poolMembers.find((row) => row.id === input.participantId);
  if (!member || member.role !== "pool") {
    throw new EscrowError("not_pool_member", "No frozen pool share matches this claim.");
  }
  if (!input.actorUserId) return;
  if (member.userId && member.userId === input.actorUserId) return;
  const [link] = await db
    .select({ githubId: githubLinks.githubId })
    .from(githubLinks)
    .where(eq(githubLinks.userId, input.actorUserId))
    .limit(1);
  if (link && link.githubId === member.githubId) return;
  throw new EscrowError(
    "not_pool_member",
    "Only that frozen pool participant can claim this share.",
  );
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
  /** Every refund leg. A single-funder refund has one entry. */
  legs: PayoutLegReport[];
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
    /**
     * Ignored. Single-funder refunds go to the x402 payer when it was stored,
     * otherwise the escrow's recorded funder, otherwise the poster's saved wallet.
     */
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
      legs: [],
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
      legs: [],
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
      legs: [],
    };
  }

  const wallets = await rail.ensureWallets();
  const splitPlan = await contributionRefundPlan(opts.db, bountyId, bounty.amountUsdc);
  if (splitPlan.kind === "split") {
    return refundSplitContributions({
      bountyId,
      faceUsdc: bounty.amountUsdc,
      escrow,
      reason: input.reason,
      actorUserId: input.actorUserId,
      plan: splitPlan,
      rail,
      wallets,
      now,
      opts,
    });
  }

  const requestId = takeRequestId(opts.requestId);
  const recordedPayer =
    payerDistinctFromEscrow(escrow.funderAddress, escrow.escrowAddress) ||
    (await walletOf(opts.db, bounty.posterUserId));
  const funderAddress = requireBasePayoutAddress(recordedPayer, "missing_funder_address");

  const split = splitFaceUsdc(bounty.amountUsdc);
  const coverage = await coverageAfterLegacy(opts, bountyId, rail.mode);
  const singleLeg: CoverageLeg = {
    destination: funderAddress,
    amount: split.faceUsdc,
    amountAtomic: split.faceAtomic,
    kind: "REFUND_OUT",
    txHash: escrow.refundTxHash?.trim() || null,
  };
  const covered = coverageDecision({
    bountyId,
    verifiedAtomic: coverage.verifiedAtomic,
    paidAtomic: coverage.paidAtomic,
    railMode: rail.mode,
    legs: [singleLeg],
  });
  if (!covered.ok) throw covered.error;

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

  const paidLegs = await executeCoveredLegs({
    bountyId,
    verifiedAtomic: coverage.verifiedAtomic,
    paidAtomic: coverage.paidAtomic,
    railMode: rail.mode,
    legs: [singleLeg],
    transfer: async () => {
      try {
        await assertPayoutCovered(opts.db, bountyId, split.faceAtomic, rail.mode);
        const sent = await transferToStoredDestination({
          db: opts.db,
          bountyId,
          to: funderAddress,
          kind: "REFUND_OUT",
          rail,
          amountAtomic: split.faceAtomic,
          idempotencyKey: refundKey,
          purpose: "refund",
          railKind: "REFUND_OUT",
        });
        logMoneyAction({
          action: "refund",
          actorUserId: input.actorUserId ?? null,
          bountyId,
          destination: funderAddress,
          amountUsdc: split.faceUsdc,
          txHash: sent.txHash,
          result: "ok",
          requestId,
          apiKeyId: opts.apiKeyId ?? null,
          leg: "REFUND_OUT",
        });
        return sent;
      } catch (err) {
        logMoneyAction({
          action: "refund",
          actorUserId: input.actorUserId ?? null,
          bountyId,
          destination: funderAddress,
          amountUsdc: split.faceUsdc,
          txHash: null,
          result: moneyResultCode(err),
          requestId,
          apiKeyId: opts.apiKeyId ?? null,
          leg: "REFUND_OUT",
        });
        throw err;
      }
    },
  });
  const sent = { txHash: paidLegs[0]?.txHash ?? escrow.refundTxHash ?? "" };
  if (!sent.txHash) {
    throw new EscrowError("rail_failed", "Refund produced no transaction hash.", {
      details: { legs: paidLegs },
    });
  }

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
    legs: paidLegs,
  };
}

/**
 * Full face still goes back and no fee is taken. Each funder receives the
 * amount they added. The escrow refund hash is the last confirmed leg.
 */
async function refundSplitContributions(input: {
  bountyId: string;
  faceUsdc: string;
  escrow: NonNullable<Awaited<ReturnType<typeof loadEscrow>>>;
  reason: "cancel" | "expiry";
  actorUserId?: string;
  plan: { kind: "split"; legs: ContributionRefundLeg[] };
  rail: CdpRail;
  wallets: RailWallets;
  now: Date;
  opts: EscrowServiceOpts;
}): Promise<RefundResult> {
  const { bountyId, faceUsdc, escrow, reason, actorUserId, plan, rail, wallets, now, opts } = input;
  const coverage = await coverageAfterLegacy(opts, bountyId, rail.mode);
  const coverageLegs: CoverageLeg[] = plan.legs.map((leg) => ({
    destination: requireBasePayoutAddress(leg.toAddress, "missing_funder_address"),
    amount: leg.amountUsdc,
    amountAtomic: leg.amountAtomic,
    kind: "REFUND_OUT",
    txHash: leg.refundTxHash?.trim() || null,
    contributionId: leg.contributionId,
  }));
  const covered = coverageDecision({
    bountyId,
    verifiedAtomic: coverage.verifiedAtomic,
    paidAtomic: coverage.paidAtomic,
    railMode: rail.mode,
    legs: coverageLegs,
  });
  if (!covered.ok) throw covered.error;

  assertEscrowTransition(escrow.status === "refunding" ? "refunding" : "funded", "refunding");
  await opts.db
    .update(bounties)
    .set({ status: "refunding", updatedAt: now })
    .where(eq(bounties.id, bountyId));
  await opts.db
    .update(escrows)
    .set({ status: "refunding", updatedAt: now })
    .where(eq(escrows.id, escrow.id));

  const requestId = takeRequestId(opts.requestId);
  const paidLegs = await executeCoveredLegs({
    bountyId,
    verifiedAtomic: coverage.verifiedAtomic,
    paidAtomic: coverage.paidAtomic,
    railMode: rail.mode,
    legs: coverageLegs,
    transfer: async (leg) => {
      const planned = plan.legs.find((row) => row.contributionId === leg.contributionId);
      if (!planned) {
        throw new EscrowError("rail_failed", "Refund leg is missing its contribution row.");
      }
      const toAddress = requireBasePayoutAddress(planned.toAddress, "missing_funder_address");
      try {
        await assertPayoutCovered(opts.db, bountyId, planned.amountAtomic, rail.mode);
        const sent = await transferToStoredDestination({
          db: opts.db,
          bountyId,
          to: toAddress,
          kind: "REFUND_OUT",
          contributionId: planned.contributionId,
          rail,
          amountAtomic: planned.amountAtomic,
          idempotencyKey: planned.idempotencyKey,
          purpose: "refund",
          railKind: "REFUND_OUT",
        });
        logMoneyAction({
          action: "refund",
          actorUserId: actorUserId ?? null,
          bountyId,
          contributionId: planned.contributionId,
          destination: toAddress,
          amountUsdc: planned.amountUsdc,
          txHash: sent.txHash,
          result: "ok",
          requestId,
          apiKeyId: opts.apiKeyId ?? null,
          leg: "REFUND_OUT",
        });
        await markContributionRefunded(opts.db, planned.contributionId, sent.txHash, now);
        planned.refundTxHash = sent.txHash;
        return sent;
      } catch (err) {
        logMoneyAction({
          action: "refund",
          actorUserId: actorUserId ?? null,
          bountyId,
          contributionId: planned.contributionId,
          destination: toAddress,
          amountUsdc: planned.amountUsdc,
          txHash: null,
          result: moneyResultCode(err),
          requestId,
          apiKeyId: opts.apiKeyId ?? null,
          leg: "REFUND_OUT",
        });
        throw err;
      }
    },
  });
  const lastHash = [...paidLegs].reverse().find((leg) => leg.txHash)?.txHash ?? null;
  if (!lastHash) {
    throw new EscrowError("rail_failed", "Multi-funder refund produced no transaction hash.", {
      details: { legs: paidLegs },
    });
  }

  const bountyTerminal = reason === "expiry" ? "expired" : "cancelled";
  await opts.db.transaction(async (tx) => {
    await tx
      .update(escrows)
      .set({
        status: "refunded",
        refundTxHash: lastHash,
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
    refundTxHash: lastHash,
    rail: rail.mode,
    network: rail.network,
    missingEnv: rail.missingEnv,
    hostedCheckout: hostedCheckoutStatus(),
    reconcile: latest ? reconcileBountyNotes(toRecon(bountyId, faceUsdc, latest)) : [],
    legs: paidLegs,
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
    ticket: "V2-5",
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
