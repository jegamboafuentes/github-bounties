import { LOCK_NOT_MONEY_COPY } from "../../bounties/display";
import { publicWorkSignals } from "../../bounties/signals";
import type { BoardBounty } from "../../bounties/list";
import { toPoolRosterView, type PoolRosterView, type RosterMemberView } from "../../bounties/roster";
import { normalizeFundTxHash } from "../../escrow/fund-hash";
import type { BountyContributionView } from "../../escrow/top-up";
import type { EscrowSnapshot } from "../../escrow/read";
import { FEE_BPS, POOL_BPS_OF_POST_FEE } from "../../lib/constants";
import { baseTxExplorerUrl } from "../../lib/explorer";
import { atomicToUsdc, usdcToAtomic } from "../../lib/money";
import type { CachedIntelligenceResult } from "../../intelligence/load";

function iso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

/** Shared list/detail fields. Detail is this object plus paid counts and tx hashes. */
export function payoutScheduleFromRoster(roster: PoolRosterView) {
  const full = rosterPayout(roster);
  return {
    faceUsdc: full.faceUsdc,
    feeUsdc: full.feeUsdc,
    feeBps: full.feeBps,
    poolBpsOfPostFee: full.poolBpsOfPostFee,
    winnerUsdc: full.winnerUsdc,
    poolTotalUsdc: full.poolTotalUsdc,
    eachUsdc: full.eachUsdc,
    eligibleCount: full.eligibleCount,
    emptyPool: full.emptyPool,
    schedule: full.schedule,
  };
}

/** No pool members yet. Same roster function the detail uses, so schedule is `roster`. */
export function emptyPoolPayout(faceUsdc: string) {
  return payoutScheduleFromRoster(toPoolRosterView({ faceUsdc, participants: [] }));
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

export function presentPublicBounty(
  bounty: BoardBounty,
  totalFundedUsdc: string,
  roster?: PoolRosterView,
) {
  const payout = roster ? payoutScheduleFromRoster(roster) : emptyPoolPayout(bounty.amountUsdc);
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
    payout,
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
  contributions?: readonly FundingContributionInput[];
  mainnet?: boolean;
}) {
  const base = presentPublicBounty(args.bounty, args.totalFundedUsdc, args.roster);
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
    workSignals: publicWorkSignals(args.bounty.status, args.bounty.workSignals).map((signal) => ({
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
    funding: presentFundingTransactions({
      contributions: args.contributions ?? [],
      escrowFundTxHash: args.escrow?.fundTxHash ?? null,
      escrowAmountUsdc: args.escrow?.amountUsdc ?? null,
      mainnet: args.mainnet ?? false,
    }),
  };
}

export type FundingContributionInput = {
  amountUsdc: string;
  fundTxHash: string | null;
  createdAt: Date;
};

export type PublicFundingTx = {
  kind: "fund" | "top_up";
  amountUsdc: string;
  txHash: string;
  createdAt: string | null;
  explorerUrl: string | null;
};

/**
 * Confirmed fund and top-up hashes, oldest first.
 * The hash that matches the escrow fund is `fund`. Every other contribution is `top_up`.
 * A legacy escrow fund with no contribution row is still included. Wallet addresses are omitted.
 */
export function presentFundingTransactions(input: {
  contributions: readonly FundingContributionInput[];
  escrowFundTxHash?: string | null;
  escrowAmountUsdc?: string | null;
  mainnet: boolean;
}): PublicFundingTx[] {
  const escrowHash = normalizeFundTxHash(input.escrowFundTxHash);
  const rows = input.contributions
    .map((row) => ({
      amountUsdc: row.amountUsdc,
      hash: normalizeFundTxHash(row.fundTxHash),
      createdAt: row.createdAt,
    }))
    .filter((row) => row.hash.length > 0)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.hash.localeCompare(b.hash));

  const seen = new Set<string>();
  const out: PublicFundingTx[] = [];
  function push(kind: PublicFundingTx["kind"], amountUsdc: string, hash: string, createdAt: Date | null) {
    if (seen.has(hash)) return;
    seen.add(hash);
    out.push({
      kind,
      amountUsdc: usdcWire(amountUsdc),
      txHash: hash,
      createdAt: createdAt ? createdAt.toISOString() : null,
      explorerUrl: baseTxExplorerUrl(hash, input.mainnet),
    });
  }

  const lock = escrowHash ? rows.find((row) => row.hash === escrowHash) : undefined;
  if (lock) {
    push("fund", lock.amountUsdc, lock.hash, lock.createdAt);
  } else if (escrowHash) {
    push("fund", input.escrowAmountUsdc || "0", escrowHash, null);
  }

  rows.forEach((row, index) => {
    if (row.hash === escrowHash) return;
    const kind = !escrowHash && index === 0 && !lock ? "fund" : "top_up";
    push(kind, row.amountUsdc, row.hash, row.createdAt);
  });

  return out;
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
