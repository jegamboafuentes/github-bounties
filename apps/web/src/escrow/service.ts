import { and, eq, inArray, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, claimLocks, claims, escrows, feeLedger, users } from "../db/schema";
import { FEE_BPS } from "../lib/constants";
import { splitFaceUsdc } from "../lib/money";
import { EscrowError } from "./errors";
import { probeCdpEnv } from "./env";
import {
  persistEscrowFail,
  toPersistedLockFailure,
  VOIDED_UNFUNDED_CODE,
  VOIDED_UNFUNDED_REASON,
} from "./fail";
import { hostedCheckoutStatus } from "./hosted";
import { moneyIdempotencyKey } from "./idempotency";
import { resolveRail, type CdpRail } from "./rail";
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

function toRecon(bountyId: string, faceUsdc: string, escrow: typeof escrows.$inferSelect): EscrowReconRow {
  return {
    bountyId,
    faceUsdc,
    escrowStatus: escrow.status,
    fundTxHash: escrow.fundTxHash,
    payoutTxHash: escrow.payoutTxHash,
    feeTxHash: escrow.feeTxHash,
    refundTxHash: escrow.refundTxHash,
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
 * Live rail requires a confirmed inbound tx or CDP_DRY_RUN_LIVE faucet.
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

  let rail: CdpRail;
  let locked: Awaited<ReturnType<CdpRail["lockFace"]>>;
  try {
    rail = railOf(opts);
    locked = await rail.lockFace({
      amountAtomic: split.faceAtomic,
      idempotencyKey: fundKey,
      fundTxHash: opts.fundTxHash,
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
      checkoutId: null,
      x402Url: null,
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
 * Release hunter net of 2% + FEE_OUT to gb-fee. Idempotent.
 * SettledPartial retries FEE_OUT only (ADR 0001).
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
  const splitEarly = splitFaceUsdc(bounty.amountUsdc, FEE_BPS);

  if (
    (bounty.status === "settled" || escrow?.status === "settled") &&
    escrow?.payoutTxHash &&
    (escrow.feeTxHash || splitEarly.feeAtomic === BigInt(0))
  ) {
    const wallets = await rail.ensureWallets();
    return finishSettleResult(bountyId, bounty.amountUsdc, escrow, "settled", rail, wallets);
  }

  if (
    !SETTLEABLE_BOUNTY_STATUSES.includes(
      bounty.status as (typeof SETTLEABLE_BOUNTY_STATUSES)[number],
    )
  ) {
    throw new EscrowError("not_settleable", `Bounty is ${bounty.status}, not settleable.`);
  }

  if (!escrow || (escrow.status !== "funded" && escrow.status !== "settling" && escrow.status !== "settled_partial")) {
    throw new EscrowError("not_settleable", "Escrow is not locked (funded) — cannot settle.");
  }

  const hunter = await resolveHunter(opts.db, bountyId, input);
  if (input.actorUserId && input.actorUserId !== bounty.posterUserId && input.actorUserId !== hunter.userId) {
    throw new EscrowError("not_settler", "Only the poster or the winning hunter can settle.");
  }

  const split = splitEarly;
  const wallets = await rail.ensureWallets();
  const hunterKey = moneyIdempotencyKey(bountyId, "HUNTER_PAYOUT");
  const feeKey = moneyIdempotencyKey(bountyId, "FEE_OUT");

  if (escrow.status === "funded") {
    assertEscrowTransition(escrow.status, "settling");
    await opts.db
      .update(bounties)
      .set({ status: "settling", updatedAt: now })
      .where(
        and(eq(bounties.id, bountyId), inArray(bounties.status, ["funded", "claim_locked"])),
      );
    await opts.db
      .update(escrows)
      .set({ status: "settling", escrowAddress: wallets.escrowAddress, updatedAt: now })
      .where(eq(escrows.id, escrow.id));
  }

  let payoutTxHash = escrow.payoutTxHash;
  let feeTxHash = escrow.feeTxHash;
  let hunterFailed = false;
  let feeFailed = false;

  if (!payoutTxHash) {
    try {
      const sent = await rail.transferUsdc({
        to: hunter.address,
        amountAtomic: split.hunterAtomic,
        idempotencyKey: hunterKey,
        purpose: "hunter",
        kind: "HUNTER_PAYOUT",
      });
      payoutTxHash = sent.txHash;
      await opts.db
        .update(escrows)
        .set({ payoutTxHash, updatedAt: now })
        .where(eq(escrows.id, escrow.id));
    } catch (err) {
      hunterFailed = true;
      if (err instanceof EscrowError) {
        throw err;
      }
      throw new EscrowError(
        "rail_failed",
        err instanceof Error ? err.message : "Hunter payout transfer failed.",
      );
    }
  }

  if (!hunterFailed && !feeTxHash && split.feeAtomic > BigInt(0)) {
    try {
      const sent = await rail.transferUsdc({
        to: wallets.feeAddress,
        amountAtomic: split.feeAtomic,
        idempotencyKey: feeKey,
        purpose: "fee",
        kind: "FEE_OUT",
      });
      feeTxHash = sent.txHash;
      await opts.db
        .update(escrows)
        .set({ feeTxHash, updatedAt: now })
        .where(eq(escrows.id, escrow.id));
    } catch {
      feeFailed = true;
    }
  }

  const terminal: "settled" | "settled_partial" =
    payoutTxHash && (feeTxHash || split.feeAtomic === BigInt(0)) && !feeFailed
      ? "settled"
      : "settled_partial";

  await opts.db.transaction(async (tx) => {
    await tx
      .update(escrows)
      .set({
        status: terminal,
        payoutTxHash,
        feeTxHash,
        escrowAddress: wallets.escrowAddress,
        updatedAt: now,
      })
      .where(eq(escrows.id, escrow.id));
    await tx
      .update(bounties)
      .set({ status: terminal, updatedAt: now })
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
            payoutUsdc: split.hunterUsdc,
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
  const result = finishSettleResult(bountyId, bounty.amountUsdc, latest, terminal, rail, wallets);
  result.hunterAddress = hunter.address;
  return result;
}

function finishSettleResult(
  bountyId: string,
  faceUsdc: string,
  escrow: typeof escrows.$inferSelect,
  bountyStatus: "settled" | "settled_partial",
  rail: CdpRail,
  wallets: { escrowAddress: string; feeAddress: string },
): SettleResult {
  const split = splitFaceUsdc(faceUsdc);
  return {
    bountyId,
    escrowStatus: escrow.status,
    bountyStatus,
    hunterUsdc: split.hunterUsdc,
    feeUsdc: split.feeUsdc,
    feeBps: split.feeBps,
    payoutTxHash: escrow.payoutTxHash,
    feeTxHash: escrow.feeTxHash,
    hunterAddress: "",
    feeAddress: wallets.feeAddress,
    rail: rail.mode,
    network: rail.network,
    missingEnv: rail.missingEnv,
    hostedCheckout: hostedCheckoutStatus(),
    reconcile: reconcileBountyNotes(toRecon(bountyId, faceUsdc, escrow)),
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
            failCode: VOIDED_UNFUNDED_CODE,
            failReason: VOIDED_UNFUNDED_REASON,
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
    ticket: "V1-5",
    network: probe.network,
    rail: probe.mode,
    missing: probe.missing,
    hosted_checkout: hostedCheckoutStatus(),
    mainnet_refused: probe.unsafeNetwork && !probe.mainnetAllowed,
    fee_bps: FEE_BPS,
    wallets: { escrow: "gb-escrow", fee: "gb-fee" },
  };
}
