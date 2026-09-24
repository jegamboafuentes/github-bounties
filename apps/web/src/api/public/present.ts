import { LOCK_NOT_MONEY_COPY, poolPayoutBreakdown } from "../../bounties/display";
import type { BoardBounty } from "../../bounties/list";
import type { PoolRosterView, RosterMemberView } from "../../bounties/roster";
import type { BountyContributionView } from "../../escrow/top-up";
import type { EscrowSnapshot } from "../../escrow/read";
import { FEE_BPS, POOL_BPS_OF_POST_FEE } from "../../lib/constants";
import { atomicToUsdc, usdcToAtomic } from "../../lib/money";
import type { CachedIntelligenceResult } from "../../intelligence/load";

function iso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

export function emptyPoolPayout(faceUsdc: string) {
  const split = poolPayoutBreakdown(faceUsdc, 0);
  return {
    faceUsdc: split.faceUsdc,
    feeUsdc: split.feeUsdc,
    feeBps: split.feeBps,
    poolBpsOfPostFee: POOL_BPS_OF_POST_FEE,
    winnerUsdc: split.winnerUsdc,
    poolTotalUsdc: split.poolTotalUsdc,
    eachUsdc: split.eachUsdc,
    eligibleCount: split.eligibleCount,
    emptyPool: split.emptyPool,
    schedule: "empty_pool" as const,
  };
}

export function rosterPayout(roster: PoolRosterView) {
  const breakdown = roster.breakdown;
  return {
    faceUsdc: breakdown.faceUsdc,
    feeUsdc: breakdown.feeUsdc,
    feeBps: FEE_BPS,
    poolBpsOfPostFee: POOL_BPS_OF_POST_FEE,
    winnerUsdc: breakdown.winnerUsdc,
    poolTotalUsdc: breakdown.poolTotalUsdc,
    eachUsdc: breakdown.eachUsdc,
    eligibleCount: breakdown.eligibleCount,
    emptyPool: breakdown.emptyPool,
    schedule: "roster" as const,
    paidCount: breakdown.paidCount,
    winnerShareLabel: breakdown.winnerShareLabel,
    poolShareLabel: breakdown.poolShareLabel,
    feeTxHash: breakdown.feeTxHash,
    winnerTxHash: breakdown.winnerTxHash,
  };
}

/** Six-decimal USDC, matching numeric(20,6) on the wire. */
export function usdcWire(value: string): string {
  return atomicToUsdc(usdcToAtomic(value));
}

/**
 * Contribution rows, newest first.
 * Mirrors the board avatar stack (latest contribution on the left, on top).
 * Tie-break is id descending, the reverse of the oldest-first contribution query.
 */
export function orderContributionsNewestFirst<T extends { createdAt: Date; id: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
  );
}

export function presentPublicBounty(bounty: BoardBounty, totalFundedUsdc: string) {
  return {
    id: bounty.id,
    issue: {
      url: bounty.url,
      repo: bounty.repoFullName,
      number: bounty.githubIssueNumber,
      title: bounty.title,
    },
    status: bounty.status,
    currency: bounty.currency,
    amountUsdc: bounty.amountUsdc,
    totalFundedUsdc: usdcWire(totalFundedUsdc),
    createdAt: bounty.createdAt.toISOString(),
    fundedAt: iso(bounty.fundedAt),
    payout: emptyPoolPayout(bounty.amountUsdc),
    intelligence: bounty.intelligence,
    funders: {
      count: bounty.funderCount,
      avatars: bounty.funders.map((funder) => ({
        displayName: funder.displayName,
        avatarUrl: funder.avatarUrl,
      })),
    },
    poster: {
      displayName: bounty.posterDisplayName,
      githubLogin: bounty.posterGithubLogin,
    },
  };
}

function presentMember(member: RosterMemberView) {
  return {
    githubLogin: member.githubLogin,
    role: member.role,
    qualifyingPrNumber: member.qualifyingPrNumber,
    qualifyingPrUrl: member.qualifyingPrUrl,
    shareUsdc: member.shareUsdc,
    paid: member.paid,
    unlinked: member.unlinked,
    payoutTxHash: member.payoutTxHash,
  };
}

export function presentBountyDetail(args: {
  bounty: BoardBounty;
  totalFundedUsdc: string;
  issueBody: string | null;
  roster: PoolRosterView;
  escrow: EscrowSnapshot | null;
}) {
  const base = presentPublicBounty(args.bounty, args.totalFundedUsdc);
  return {
    bounty: {
      ...base,
      issue: { ...base.issue, body: args.issueBody },
      payout: rosterPayout(args.roster),
    },
    lock: {
      exclusiveClaimLock: "retired" as const,
      activeLock: null,
      note: LOCK_NOT_MONEY_COPY,
    },
    workSignals: args.bounty.workSignals.map((signal) => ({
      githubLogin: signal.githubLogin,
      hunterLabel: signal.hunterLabel,
      signaledAt: signal.signaledAt.toISOString(),
    })),
    escrow: args.escrow
      ? {
          status: args.escrow.status,
          amountUsdc: args.escrow.amountUsdc,
          rail: args.escrow.rail,
          inboundRecorded: args.escrow.inboundRecorded,
          failCode: args.escrow.failCode,
          failLabel: args.escrow.failLabel,
        }
      : null,
    roster: {
      frozen: args.roster.frozen,
      frozenAt: iso(args.roster.frozenAt),
      overflowCount: args.roster.overflowCount,
      overflowCaption: args.roster.overflowCaption,
      eligibilityFreezeCopy: args.roster.eligibilityFreezeCopy,
      winner: args.roster.winner ? presentMember(args.roster.winner) : null,
      pool: args.roster.pool.map(presentMember),
      overflow: args.roster.overflow.map(presentMember),
      excludedPoster: args.roster.excludedPoster ? presentMember(args.roster.excludedPoster) : null,
    },
    pendingHunterLink: args.bounty.pendingHunterLink
      ? {
          winnerLogin: args.bounty.pendingHunterLink.winnerLogin,
          prNumber: args.bounty.pendingHunterLink.prNumber,
        }
      : null,
  };
}

export function presentFunderContribution(row: BountyContributionView) {
  return {
    displayName: row.displayName,
    githubLogin: row.githubLogin,
    avatarUrl: row.avatarUrl,
    amountUsdc: row.amountUsdc,
    createdAt: row.createdAt.toISOString(),
  };
}

export function presentFunderList(bountyId: string, rows: readonly BountyContributionView[]) {
  return {
    bountyId,
    data: orderContributionsNewestFirst(rows).map(presentFunderContribution),
  };
}

export function presentCachedIntelligence(bountyId: string, intel: CachedIntelligenceResult) {
  return { bountyId, ...intel };
}
