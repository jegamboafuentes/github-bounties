import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { allocationLedger, bounties, poolParticipants } from "../db/schema";
import { CLAIM_SKIP } from "../webhooks/outcome";
import { POOL_MAX_PAID } from "../lib/constants";
import { splitPostFeePool, type PostFeePoolSplit } from "../lib/money";
import { ELIGIBILITY_FREEZE_COPY, overflowNotPaidLabel } from "./display";

export type PoolParticipantRole = (typeof poolParticipants.$inferSelect)["role"];

export type RosterMemberView = {
  id: string;
  githubLogin: string;
  githubId: string;
  userId: string | null;
  role: PoolParticipantRole;
  qualifyingPrNumber: number | null;
  qualifyingPrUrl: string | null;
  shareUsdc: string;
  payoutTxHash: string | null;
  skipReason: string | null;
  frozen: boolean;
  unlinked: boolean;
  paid: boolean;
};

export type AllocationLegView = {
  kind: string;
  participantId: string | null;
  amountUsdc: string;
  txHash: string | null;
  status: string;
  githubLogin: string | null;
};

export type PayoutBreakdownView = {
  faceUsdc: string;
  feeUsdc: string;
  winnerUsdc: string;
  poolTotalUsdc: string;
  eachUsdc: string | null;
  eligibleCount: number;
  paidCount: number;
  emptyPool: boolean;
  winnerShareLabel: string;
  poolShareLabel: string;
  feeTxHash: string | null;
  winnerTxHash: string | null;
};

export type PoolRosterView = {
  frozen: boolean;
  frozenAt: Date | null;
  winner: RosterMemberView | null;
  pool: RosterMemberView[];
  overflow: RosterMemberView[];
  overflowCount: number;
  overflowCaption: string | null;
  excludedPoster: RosterMemberView | null;
  candidates: RosterMemberView[];
  eligibilityFreezeCopy: string;
  breakdown: PayoutBreakdownView;
  legs: AllocationLegView[];
};

type ParticipantRow = typeof poolParticipants.$inferSelect;
type LedgerRow = typeof allocationLedger.$inferSelect;

function byQualifyingPr(a: ParticipantRow, b: ParticipantRow): number {
  const at = a.qualifyingPrCreatedAt?.getTime() ?? 0;
  const bt = b.qualifyingPrCreatedAt?.getTime() ?? 0;
  if (at !== bt) return at - bt;
  const an = a.qualifyingPrNumber ?? 0;
  const bn = b.qualifyingPrNumber ?? 0;
  if (an !== bn) return an - bn;
  if (a.githubId < b.githubId) return -1;
  if (a.githubId > b.githubId) return 1;
  return 0;
}

function isUnlinked(row: ParticipantRow): boolean {
  return row.userId == null || row.skipReason === CLAIM_SKIP.hunterNotLinked;
}

function toMember(row: ParticipantRow, payoutTxHash: string | null): RosterMemberView {
  return {
    id: row.id,
    githubLogin: row.githubLogin,
    githubId: row.githubId.toString(),
    userId: row.userId,
    role: row.role,
    qualifyingPrNumber: row.qualifyingPrNumber,
    qualifyingPrUrl: row.qualifyingPrUrl,
    shareUsdc: row.shareUsdc,
    payoutTxHash,
    skipReason: row.skipReason,
    frozen: row.frozenAt != null,
    unlinked: isUnlinked(row),
    paid: Boolean(payoutTxHash),
  };
}

function txForParticipant(row: ParticipantRow, legs: LedgerRow[]): string | null {
  const fromRow = row.payoutTxHash?.trim() || null;
  if (fromRow) return fromRow;
  const kind = row.role === "winner" ? "WINNER_PAYOUT" : "POOL_PAYOUT";
  const leg = legs.find(
    (item) =>
      item.participantId === row.id &&
      item.kind === kind &&
      (item.status === "confirmed" || Boolean(item.txHash)),
  );
  return leg?.txHash ?? null;
}

export function payoutShareLabels(split: PostFeePoolSplit): {
  winnerShareLabel: string;
  poolShareLabel: string;
} {
  if (split.eligibleCount === 0) {
    return {
      winnerShareLabel: "100% of post-fee",
      poolShareLabel: "0",
    };
  }
  return {
    winnerShareLabel: "≈83.3%",
    poolShareLabel: "≈14.7%",
  };
}

export function toPoolRosterView(args: {
  faceUsdc: string;
  participants: ParticipantRow[];
  legs?: LedgerRow[];
}): PoolRosterView {
  const legs = args.legs ?? [];
  const frozenRows = args.participants.filter((row) => row.frozenAt != null);
  const frozen = frozenRows.length > 0;
  const source = frozen ? frozenRows : args.participants;
  const winnerRow = source.find((row) => row.role === "winner") ?? null;
  const poolRows = source.filter((row) => row.role === "pool").slice().sort(byQualifyingPr);
  const overflowRows = source.filter((row) => row.role === "overflow").slice().sort(byQualifyingPr);
  const posterRow =
    source.find((row) => row.role === "excluded_poster" && row.qualifyingPrNumber != null) ??
    null;
  const candidates = frozen
    ? []
    : args.participants
        .filter((row) => row.frozenAt == null)
        .slice()
        .sort(byQualifyingPr)
        .map((row) => toMember(row, null));

  const eligibleCount = frozen
    ? poolRows.length + overflowRows.length
    : args.participants.filter((row) => row.role === "pool" || row.role === "overflow").length;
  const split = splitPostFeePool(args.faceUsdc, eligibleCount);
  const labels = payoutShareLabels(split);

  const feeTxHash =
    legs.find((leg) => leg.kind === "FEE_OUT" && (leg.status === "confirmed" || leg.txHash))
      ?.txHash ?? null;
  const winnerTxHash =
    (winnerRow ? txForParticipant(winnerRow, legs) : null) ??
    legs.find((leg) => leg.kind === "WINNER_PAYOUT" && (leg.status === "confirmed" || leg.txHash))
      ?.txHash ??
    null;

  const winner = winnerRow ? toMember(winnerRow, winnerTxHash) : null;
  const pool = poolRows.map((row) => toMember(row, txForParticipant(row, legs)));
  const overflow = overflowRows.map((row) => toMember(row, null));
  const overflowCount = overflow.length;
  const loginByParticipant = new Map(
    args.participants.map((row) => [row.id, row.githubLogin] as const),
  );

  return {
    frozen,
    frozenAt: frozenRows[0]?.frozenAt ?? null,
    winner,
    pool,
    overflow,
    overflowCount,
    overflowCaption: overflowCount > 0 ? overflowNotPaidLabel(overflowCount, POOL_MAX_PAID) : null,
    excludedPoster: posterRow ? toMember(posterRow, null) : null,
    candidates,
    eligibilityFreezeCopy: ELIGIBILITY_FREEZE_COPY,
    breakdown: {
      faceUsdc: split.faceUsdc,
      feeUsdc: split.feeUsdc,
      winnerUsdc: split.winnerUsdc,
      poolTotalUsdc: split.poolTotalUsdc,
      eachUsdc: split.eachUsdc,
      eligibleCount: split.eligibleCount,
      paidCount: split.paidCount,
      emptyPool: split.eligibleCount === 0,
      winnerShareLabel: labels.winnerShareLabel,
      poolShareLabel: labels.poolShareLabel,
      feeTxHash,
      winnerTxHash,
    },
    legs: legs.map((leg) => ({
      kind: leg.kind,
      participantId: leg.participantId,
      amountUsdc: leg.amountUsdc,
      txHash: leg.txHash,
      status: leg.status,
      githubLogin: leg.participantId ? (loginByParticipant.get(leg.participantId) ?? null) : null,
    })),
  };
}

export async function getPoolRoster(
  bountyId: string,
  db: Database,
): Promise<PoolRosterView | null> {
  const [bounty] = await db
    .select({ amountUsdc: bounties.amountUsdc })
    .from(bounties)
    .where(eq(bounties.id, bountyId))
    .limit(1);
  if (!bounty) return null;

  const [participants, legs] = await Promise.all([
    db.select().from(poolParticipants).where(eq(poolParticipants.bountyId, bountyId)),
    db.select().from(allocationLedger).where(eq(allocationLedger.bountyId, bountyId)),
  ]);

  return toPoolRosterView({
    faceUsdc: bounty.amountUsdc,
    participants,
    legs,
  });
}
