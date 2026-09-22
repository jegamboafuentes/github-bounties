/**
 * Domain email hooks for V3.x A2. DEV only.
 *
 * Recipients are signed-up `users.email` via `enqueueEmailForUser`.
 * Callers never pass an address. GitHub profile mail is not read.
 * Every function swallows its own errors so fund, webhook, and Claim
 * still commit when the outbox or provider misbehaves.
 */

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { EnvMap } from "../auth/env";
import { formatUsdc } from "../bounties/display";
import type { Database } from "../db/client";
import {
  allocationLedger,
  bounties,
  claims,
  escrows,
  poolParticipants,
  repos,
  type EmailOutboxPayload,
} from "../db/schema";
import { usdcToAtomic } from "../lib/money";
import type { TransactionalEmailAdapter } from "./adapter";
import { readEmailOrigin } from "./env";
import { deliverOutbox, enqueueEmailForUser } from "./outbox";
import {
  bountyFundedIdempotencyKey,
  bountySettledIdempotencyKey,
  poolClaimableIdempotencyKey,
  prMergedIdempotencyKey,
} from "./templates";

export type DomainEmailDeps = {
  env?: EnvMap;
  adapter?: TransactionalEmailAdapter;
};

const LOCK_CONFIRMED_STATUSES = new Set([
  "funded",
  "claim_locked",
  "settling",
  "settled",
  "settled_partial",
]);

type BountyMailContext = {
  id: string;
  title: string;
  amountUsdc: string;
  issueNumber: number;
  posterUserId: string;
  repoFullName: string;
  status: string;
};

function logSkip(template: string, reason: string, userId?: string | null): void {
  console.error(
    JSON.stringify({
      event: "domain_email_skipped",
      template,
      userId: userId ?? null,
      reason,
    }),
  );
}

function logFailure(template: string, error: unknown, userId?: string | null): void {
  const message = error instanceof Error ? error.message : "email_failed";
  console.error(
    JSON.stringify({
      event: "domain_email_failed",
      template,
      userId: userId ?? null,
      error: message.slice(0, 300),
    }),
  );
}

function amountLabel(usdc: string): string {
  return `${formatUsdc(usdc)} USDC`;
}

function positiveUsdc(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    return usdcToAtomic(value) > 0n;
  } catch {
    return false;
  }
}

async function loadBountyMailContext(
  db: Database,
  bountyId: string,
): Promise<BountyMailContext | null> {
  const [row] = await db
    .select({
      id: bounties.id,
      title: bounties.title,
      amountUsdc: bounties.amountUsdc,
      issueNumber: bounties.githubIssueNumber,
      posterUserId: bounties.posterUserId,
      repoFullName: repos.fullName,
      status: bounties.status,
    })
    .from(bounties)
    .innerJoin(repos, eq(repos.id, bounties.repoId))
    .where(eq(bounties.id, bountyId))
    .limit(1);
  return row ?? null;
}

function payloadFor(
  ctx: BountyMailContext,
  amountUsdc: string,
  env?: EnvMap,
): EmailOutboxPayload {
  return {
    bountyTitle: ctx.title,
    bountyUrl: `${readEmailOrigin(env)}/bounties/${ctx.id}`,
    amountLabel: amountLabel(amountUsdc),
    repoFullName: ctx.repoFullName,
    issueNumber: ctx.issueNumber,
  };
}

async function enqueueAndDeliver(
  db: Database,
  input: {
    userId: string;
    template: "bounty_funded" | "pr_merged" | "bounty_settled" | "pool_claimable";
    idempotencyKey: string;
    payload: EmailOutboxPayload;
  },
  deps?: DomainEmailDeps,
): Promise<void> {
  try {
    const enqueued = await enqueueEmailForUser(
      {
        userId: input.userId,
        template: input.template,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
      },
      db,
    );
    if (!enqueued.ok) {
      logSkip(input.template, enqueued.reason, input.userId);
      return;
    }
    await deliverOutbox({
      db,
      env: deps?.env,
      adapter: deps?.adapter,
      userId: input.userId,
      limit: 5,
    });
  } catch (err) {
    logFailure(input.template, err, input.userId);
  }
}

/**
 * Funder only, after `lockEscrowFunds` has committed `funded`.
 * Pending fund and x402 challenge do not call this.
 */
export async function notifyBountyFunded(
  db: Database,
  bountyId: string,
  deps?: DomainEmailDeps,
): Promise<void> {
  try {
    const ctx = await loadBountyMailContext(db, bountyId);
    if (!ctx) {
      logSkip("bounty_funded", "missing_bounty");
      return;
    }
    if (!LOCK_CONFIRMED_STATUSES.has(ctx.status)) return;
    await enqueueAndDeliver(
      db,
      {
        userId: ctx.posterUserId,
        template: "bounty_funded",
        idempotencyKey: bountyFundedIdempotencyKey(ctx.id),
        payload: payloadFor(ctx, ctx.amountUsdc, deps?.env),
      },
      deps,
    );
  } catch (err) {
    logFailure("bounty_funded", err);
  }
}

/**
 * Winning developer, at the moment a claim row is winner-eligible.
 * Same write as `markEligibleClaims`. Not sent for skipped or terminal claims.
 */
export async function notifyPullRequestWon(
  db: Database,
  claimId: string,
  deps?: DomainEmailDeps,
): Promise<void> {
  try {
    const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
    if (!claim || claim.status !== "eligible") return;
    const ctx = await loadBountyMailContext(db, claim.bountyId);
    if (!ctx) {
      logSkip("pr_merged", "missing_bounty", claim.hunterUserId);
      return;
    }
    await enqueueAndDeliver(
      db,
      {
        userId: claim.hunterUserId,
        template: "pr_merged",
        idempotencyKey: prMergedIdempotencyKey(claim.id),
        payload: payloadFor(ctx, ctx.amountUsdc, deps?.env),
      },
      deps,
    );
  } catch (err) {
    logFailure("pr_merged", err);
  }
}

async function winnerShareAmount(db: Database, bountyId: string, claimPayoutUsdc: string | null): Promise<string | null> {
  const stamped = claimPayoutUsdc?.trim();
  if (stamped && positiveUsdc(stamped)) return stamped;
  const [leg] = await db
    .select({ amountUsdc: allocationLedger.amountUsdc })
    .from(allocationLedger)
    .where(and(eq(allocationLedger.bountyId, bountyId), eq(allocationLedger.kind, "WINNER_PAYOUT")))
    .limit(1);
  const fromLeg = leg?.amountUsdc?.trim();
  if (fromLeg && positiveUsdc(fromLeg)) return fromLeg;
  return null;
}

/**
 * Winning developer after the winner wallet leg has a tx hash.
 * Net amount is `claims.payout_usdc` when settlement stamped it, otherwise
 * the confirmed WINNER_PAYOUT ledger amount. No claim row means no recipient.
 */
export async function notifyWinnerSettled(
  db: Database,
  bountyId: string,
  deps?: DomainEmailDeps,
): Promise<void> {
  try {
    const [escrow] = await db
      .select({ payoutTxHash: escrows.payoutTxHash })
      .from(escrows)
      .where(eq(escrows.bountyId, bountyId))
      .limit(1);
    if (!escrow?.payoutTxHash?.trim()) return;

    const claimRows = await db
      .select()
      .from(claims)
      .where(eq(claims.bountyId, bountyId))
      .orderBy(desc(claims.updatedAt));
    const claim =
      claimRows.find((row) => row.payoutTxHash === escrow.payoutTxHash) ??
      claimRows.find((row) => row.status === "paid") ??
      claimRows.find((row) => row.status === "eligible");
    if (!claim) return;

    const amount = await winnerShareAmount(db, bountyId, claim.payoutUsdc);
    if (!amount) {
      logSkip("bounty_settled", "missing_amount", claim.hunterUserId);
      return;
    }
    const ctx = await loadBountyMailContext(db, bountyId);
    if (!ctx) {
      logSkip("bounty_settled", "missing_bounty", claim.hunterUserId);
      return;
    }
    await enqueueAndDeliver(
      db,
      {
        userId: claim.hunterUserId,
        template: "bounty_settled",
        idempotencyKey: bountySettledIdempotencyKey(claim.id),
        payload: payloadFor(ctx, amount, deps?.env),
      },
      deps,
    );
  } catch (err) {
    logFailure("bounty_settled", err);
  }
}

/**
 * Each frozen non-winning pool participant with a positive unpaid share,
 * once the winner payout tx exists (shares are claimable). Overflow, the
 * winner role, zero shares, already-paid shares, and rows with no `user_id`
 * are skipped. Does not submit a pool payout.
 */
export async function notifyPoolSharesIfClaimable(
  db: Database,
  bountyId: string,
  deps?: DomainEmailDeps,
): Promise<void> {
  try {
    const [escrow] = await db
      .select({ payoutTxHash: escrows.payoutTxHash })
      .from(escrows)
      .where(eq(escrows.bountyId, bountyId))
      .limit(1);
    if (!escrow?.payoutTxHash?.trim()) return;

    const ctx = await loadBountyMailContext(db, bountyId);
    if (!ctx) return;

    const members = await db
      .select()
      .from(poolParticipants)
      .where(
        and(
          eq(poolParticipants.bountyId, bountyId),
          eq(poolParticipants.role, "pool"),
          isNotNull(poolParticipants.frozenAt),
          isNotNull(poolParticipants.userId),
          isNull(poolParticipants.payoutTxHash),
        ),
      );

    for (const member of members) {
      if (!member.userId || !positiveUsdc(member.shareUsdc)) continue;
      await enqueueAndDeliver(
        db,
        {
          userId: member.userId,
          template: "pool_claimable",
          idempotencyKey: poolClaimableIdempotencyKey(bountyId, member.id),
          payload: payloadFor(ctx, member.shareUsdc, deps?.env),
        },
        deps,
      );
    }
  } catch (err) {
    logFailure("pool_claimable", err);
  }
}

/** After a successful settle return: winner paid, then claimable pool shares. */
export async function notifyAfterWinnerPayout(
  db: Database,
  bountyId: string,
  deps?: DomainEmailDeps,
): Promise<void> {
  await notifyWinnerSettled(db, bountyId, deps);
  await notifyPoolSharesIfClaimable(db, bountyId, deps);
}
