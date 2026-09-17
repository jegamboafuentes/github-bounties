import { POOL_BPS_OF_POST_FEE, POOL_MAX_PAID } from "../lib/constants";
import { splitPostFeePool } from "../lib/money";
import {
  allocationLedger,
  bounties,
  claims,
  escrows,
  githubLinks,
  poolParticipants,
  users,
  workSignals,
} from "./schema";

/** Same ids as `SEED` in seed.ts — keep in sync. */
const MAINTAINER_ID = "00000000-0000-4000-8000-000000000001";
const HUNTER_ID = "00000000-0000-4000-8000-000000000002";
const REPO_ID = "00000000-0000-4000-8000-000000000010";

/** Stable ids so V2-1 seed fixtures are idempotent. */
export const SEED_V2 = {
  aliceId: "00000000-0000-4000-8000-000000000003",
  bobId: "00000000-0000-4000-8000-000000000004",
  twoHunterBountyId: "00000000-0000-4000-8000-000000000071",
  overflowBountyId: "00000000-0000-4000-8000-000000000072",
  emptyPoolBountyId: "00000000-0000-4000-8000-000000000073",
  posterExcludedBountyId: "00000000-0000-4000-8000-000000000074",
  unlinkedBountyId: "00000000-0000-4000-8000-000000000075",
  twoHunterEscrowId: "00000000-0000-4000-8000-000000000081",
  overflowEscrowId: "00000000-0000-4000-8000-000000000082",
  emptyEscrowId: "00000000-0000-4000-8000-000000000083",
  posterEscrowId: "00000000-0000-4000-8000-000000000084",
  unlinkedEscrowId: "00000000-0000-4000-8000-000000000085",
  twoHunterClaimId: "00000000-0000-4000-8000-000000000091",
  overflowClaimId: "00000000-0000-4000-8000-000000000092",
  emptyClaimId: "00000000-0000-4000-8000-000000000093",
  posterClaimId: "00000000-0000-4000-8000-000000000094",
  unlinkedClaimId: "00000000-0000-4000-8000-000000000095",
  unlinkedGithubId: 999_001,
  botGithubId: 991,
} as const;

const FACE = "100.000000";
const FROZEN_AT = new Date("2026-09-17T12:00:00.000Z");
const REPO = "octo/hello";
const WINNER_LOGIN = "octocat";
const WINNER_GITHUB_ID = 2n;
const POSTER_LOGIN = "ada-maintainer";
const POSTER_GITHUB_ID = 1n;
const WINNER_PAYOUT = "0x0000000000000000000000000000000000000001";
const POOL_PAYOUT = "0x00000000000000000000000000000000000000a1";

export function overflowHunterId(n: number): string {
  return `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
}

export function overflowGithubId(n: number): bigint {
  return BigInt(2100 + n);
}

function participantId(suffix: number): string {
  return `00000000-0000-4000-8000-0000000002${String(suffix).padStart(2, "0")}`;
}

function ledgerId(suffix: number): string {
  return `00000000-0000-4000-8000-0000000003${String(suffix).padStart(2, "0")}`;
}

function signalId(suffix: number): string {
  return `00000000-0000-4000-8000-0000000004${String(suffix).padStart(2, "0")}`;
}

function prUrl(number: number): string {
  return `https://github.com/${REPO}/pull/${number}`;
}

function issueUrl(number: number): string {
  return `https://github.com/${REPO}/issues/${number}`;
}

function sha(tag: string): string {
  return tag.padEnd(40, "0");
}

function idempotencyKey(
  bountyId: string,
  kind: "FEE_OUT" | "WINNER_PAYOUT" | "POOL_PAYOUT",
  participantIdValue: string | null,
): string {
  return `gb-v2-1:${bountyId}:${kind}:${participantIdValue ?? "fee"}`;
}

type Db = ReturnType<typeof import("./client").createDb>["db"];

export async function seedV2PoolFixtures(db: Db): Promise<void> {
  await db
    .insert(users)
    .values([
      {
        id: SEED_V2.aliceId,
        googleSub: "seed-google-alice",
        email: "alice@example.com",
        displayName: "Alice Hunter",
        walletAddress: POOL_PAYOUT,
      },
      {
        id: SEED_V2.bobId,
        googleSub: "seed-google-bob",
        email: "bob@example.com",
        displayName: "Bob Hunter",
        walletAddress: "0x00000000000000000000000000000000000000b0",
      },
      ...Array.from({ length: POOL_MAX_PAID + 1 }, (_, i) => {
        const n = i + 1;
        return {
          id: overflowHunterId(n),
          googleSub: `seed-google-overflow-${n}`,
          email: `overflow${n}@example.com`,
          displayName: `Overflow ${n}`,
          walletAddress: null as string | null,
        };
      }),
    ])
    .onConflictDoNothing();

  await db
    .insert(githubLinks)
    .values([
      {
        userId: SEED_V2.aliceId,
        githubId: BigInt(3),
        githubLogin: "alice",
      },
      {
        userId: SEED_V2.bobId,
        githubId: BigInt(4),
        githubLogin: "bob",
      },
      ...Array.from({ length: POOL_MAX_PAID + 1 }, (_, i) => {
        const n = i + 1;
        return {
          userId: overflowHunterId(n),
          githubId: overflowGithubId(n),
          githubLogin: `hunter${String(n).padStart(2, "0")}`,
        };
      }),
    ])
    .onConflictDoNothing();

  await seedTwoHunterPool(db);
  await seedOverflowPool(db);
  await seedEmptyPool(db);
  await seedPosterExcluded(db);
  await seedUnlinkedGithubId(db);
}

async function insertFundedBounty(
  db: Db,
  args: { id: string; issue: number; title: string },
): Promise<void> {
  await db
    .insert(bounties)
    .values({
      id: args.id,
      repoId: REPO_ID,
      githubIssueNumber: args.issue,
      url: issueUrl(args.issue),
      posterUserId: MAINTAINER_ID,
      amountUsdc: FACE,
      currency: "USDC",
      chain: "base",
      status: "funded",
      title: args.title,
      descriptionSnapshot: "V2-1 schema fixture. No exclusive claim-lock.",
      fundedAt: FROZEN_AT,
      participationPoolBps: POOL_BPS_OF_POST_FEE,
    })
    .onConflictDoNothing();
}

async function insertWinnerClaim(
  db: Db,
  args: {
    id: string;
    bountyId: string;
    issue: number;
    prNumber: number;
    payoutUsdc: string;
    payoutTxHash: string;
  },
): Promise<void> {
  await db
    .insert(claims)
    .values({
      id: args.id,
      bountyId: args.bountyId,
      hunterUserId: HUNTER_ID,
      status: "eligible",
      prNumber: args.prNumber,
      prUrl: prUrl(args.prNumber),
      prAuthorLogin: WINNER_LOGIN,
      closedIssueNumber: args.issue,
      payoutAddress: WINNER_PAYOUT,
      payoutUsdc: args.payoutUsdc,
      payoutTxHash: args.payoutTxHash,
    })
    .onConflictDoNothing();
}

async function insertEscrow(
  db: Db,
  args: { id: string; bountyId: string; payoutTxHash: string; feeTxHash: string },
): Promise<void> {
  await db
    .insert(escrows)
    .values({
      id: args.id,
      bountyId: args.bountyId,
      amountUsdc: FACE,
      status: "funded",
      payoutTxHash: args.payoutTxHash,
      feeTxHash: args.feeTxHash,
      escrowAddress: "0x00000000000000000000000000000000000e5c00",
    })
    .onConflictDoNothing();
}

async function seedTwoHunterPool(db: Db): Promise<void> {
  const split = splitPostFeePool(FACE, 2);
  const bountyId = SEED_V2.twoHunterBountyId;
  const winnerHash = "mock:0xv21winner50";
  const feeHash = "mock:0xv21fee50";
  const aliceHash = "mock:0xv21alice50";
  const bobHash = "mock:0xv21bob50";
  const winnerPid = participantId(1);
  const alicePid = participantId(2);
  const bobPid = participantId(3);

  await insertFundedBounty(db, {
    id: bountyId,
    issue: 50,
    title: "V2-1 seed: 2-hunter pool on #50",
  });
  await insertEscrow(db, {
    id: SEED_V2.twoHunterEscrowId,
    bountyId,
    payoutTxHash: winnerHash,
    feeTxHash: feeHash,
  });
  await insertWinnerClaim(db, {
    id: SEED_V2.twoHunterClaimId,
    bountyId,
    issue: 50,
    prNumber: 100,
    payoutUsdc: split.winnerUsdc,
    payoutTxHash: winnerHash,
  });

  await db
    .insert(poolParticipants)
    .values([
      {
        id: winnerPid,
        bountyId,
        githubId: WINNER_GITHUB_ID,
        githubLogin: WINNER_LOGIN,
        userId: HUNTER_ID,
        role: "winner",
        qualifyingPrNumber: 100,
        qualifyingPrCreatedAt: FROZEN_AT,
        qualifyingPrUrl: prUrl(100),
        commitSha: sha("aa"),
        frozenAt: FROZEN_AT,
        shareUsdc: split.winnerUsdc,
        payoutAddress: WINNER_PAYOUT,
        payoutTxHash: winnerHash,
      },
      {
        id: alicePid,
        bountyId,
        githubId: BigInt(3),
        githubLogin: "alice",
        userId: SEED_V2.aliceId,
        role: "pool",
        qualifyingPrNumber: 10,
        qualifyingPrCreatedAt: new Date("2026-09-17T10:00:00.000Z"),
        qualifyingPrUrl: prUrl(10),
        commitSha: sha("ab"),
        frozenAt: FROZEN_AT,
        shareUsdc: split.eachUsdc ?? "0",
        payoutAddress: POOL_PAYOUT,
        payoutTxHash: aliceHash,
      },
      {
        id: bobPid,
        bountyId,
        githubId: BigInt(4),
        githubLogin: "bob",
        userId: SEED_V2.bobId,
        role: "pool",
        qualifyingPrNumber: 11,
        qualifyingPrCreatedAt: new Date("2026-09-17T11:00:00.000Z"),
        qualifyingPrUrl: prUrl(11),
        commitSha: sha("ac"),
        frozenAt: FROZEN_AT,
        shareUsdc: split.eachUsdc ?? "0",
        payoutAddress: "0x00000000000000000000000000000000000000b0",
        payoutTxHash: bobHash,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(allocationLedger)
    .values([
      {
        id: ledgerId(1),
        bountyId,
        participantId: null,
        kind: "FEE_OUT",
        amountUsdc: split.feeUsdc,
        toAddress: "gb-fee",
        idempotencyKey: idempotencyKey(bountyId, "FEE_OUT", null),
        txHash: feeHash,
        status: "confirmed",
      },
      {
        id: ledgerId(2),
        bountyId,
        participantId: winnerPid,
        kind: "WINNER_PAYOUT",
        amountUsdc: split.winnerUsdc,
        toAddress: WINNER_PAYOUT,
        idempotencyKey: idempotencyKey(bountyId, "WINNER_PAYOUT", winnerPid),
        txHash: winnerHash,
        status: "confirmed",
      },
      {
        id: ledgerId(3),
        bountyId,
        participantId: alicePid,
        kind: "POOL_PAYOUT",
        amountUsdc: split.eachUsdc ?? "0",
        toAddress: POOL_PAYOUT,
        idempotencyKey: idempotencyKey(bountyId, "POOL_PAYOUT", alicePid),
        txHash: aliceHash,
        status: "confirmed",
      },
      {
        id: ledgerId(4),
        bountyId,
        participantId: bobPid,
        kind: "POOL_PAYOUT",
        amountUsdc: split.eachUsdc ?? "0",
        toAddress: "0x00000000000000000000000000000000000000b0",
        idempotencyKey: idempotencyKey(bountyId, "POOL_PAYOUT", bobPid),
        txHash: bobHash,
        status: "confirmed",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(workSignals)
    .values([
      {
        id: signalId(1),
        bountyId,
        userId: SEED_V2.aliceId,
        signaledAt: new Date("2026-09-16T09:00:00.000Z"),
        clearedAt: new Date("2026-09-16T18:00:00.000Z"),
      },
      {
        id: signalId(2),
        bountyId,
        userId: SEED_V2.aliceId,
        signaledAt: new Date("2026-09-17T08:00:00.000Z"),
        clearedAt: null,
      },
      {
        id: signalId(3),
        bountyId,
        userId: SEED_V2.bobId,
        signaledAt: new Date("2026-09-17T09:00:00.000Z"),
        clearedAt: null,
      },
    ])
    .onConflictDoNothing();
}

async function seedOverflowPool(db: Db): Promise<void> {
  const split = splitPostFeePool(FACE, POOL_MAX_PAID + 1);
  const bountyId = SEED_V2.overflowBountyId;
  const winnerHash = "mock:0xv21winner51";
  const feeHash = "mock:0xv21fee51";
  const winnerPid = participantId(11);

  await insertFundedBounty(db, {
    id: bountyId,
    issue: 51,
    title: "V2-1 seed: 11th overflow on #51",
  });
  await insertEscrow(db, {
    id: SEED_V2.overflowEscrowId,
    bountyId,
    payoutTxHash: winnerHash,
    feeTxHash: feeHash,
  });
  await insertWinnerClaim(db, {
    id: SEED_V2.overflowClaimId,
    bountyId,
    issue: 51,
    prNumber: 200,
    payoutUsdc: split.winnerUsdc,
    payoutTxHash: winnerHash,
  });

  const poolRows = Array.from({ length: POOL_MAX_PAID }, (_, i) => {
    const n = i + 1;
    const hour = String(n).padStart(2, "0");
    return {
      id: participantId(20 + n),
      bountyId,
      githubId: overflowGithubId(n),
      githubLogin: `hunter${hour}`,
      userId: overflowHunterId(n),
      role: "pool" as const,
      qualifyingPrNumber: n,
      qualifyingPrCreatedAt: new Date(`2026-09-16T${hour}:00:00.000Z`),
      qualifyingPrUrl: prUrl(n),
      commitSha: sha(`p${hour}`),
      frozenAt: FROZEN_AT,
      shareUsdc: split.eachUsdc ?? "0",
    };
  });

  await db
    .insert(poolParticipants)
    .values([
      {
        id: winnerPid,
        bountyId,
        githubId: WINNER_GITHUB_ID,
        githubLogin: WINNER_LOGIN,
        userId: HUNTER_ID,
        role: "winner",
        qualifyingPrNumber: 200,
        qualifyingPrCreatedAt: FROZEN_AT,
        qualifyingPrUrl: prUrl(200),
        commitSha: sha("ow"),
        frozenAt: FROZEN_AT,
        shareUsdc: split.winnerUsdc,
        payoutAddress: WINNER_PAYOUT,
        payoutTxHash: winnerHash,
      },
      ...poolRows,
      {
        id: participantId(31),
        bountyId,
        githubId: overflowGithubId(11),
        githubLogin: "hunter11",
        userId: overflowHunterId(11),
        role: "overflow",
        qualifyingPrNumber: 11,
        qualifyingPrCreatedAt: new Date("2026-09-16T11:00:00.000Z"),
        qualifyingPrUrl: prUrl(11),
        commitSha: sha("p11"),
        frozenAt: FROZEN_AT,
        shareUsdc: "0",
        skipReason: "overflow",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(allocationLedger)
    .values([
      {
        id: ledgerId(11),
        bountyId,
        participantId: null,
        kind: "FEE_OUT",
        amountUsdc: split.feeUsdc,
        toAddress: "gb-fee",
        idempotencyKey: idempotencyKey(bountyId, "FEE_OUT", null),
        txHash: feeHash,
        status: "confirmed",
      },
      {
        id: ledgerId(12),
        bountyId,
        participantId: winnerPid,
        kind: "WINNER_PAYOUT",
        amountUsdc: split.winnerUsdc,
        toAddress: WINNER_PAYOUT,
        idempotencyKey: idempotencyKey(bountyId, "WINNER_PAYOUT", winnerPid),
        txHash: winnerHash,
        status: "confirmed",
      },
      ...poolRows.map((row, i) => ({
        id: ledgerId(20 + i),
        bountyId,
        participantId: row.id,
        kind: "POOL_PAYOUT" as const,
        amountUsdc: split.eachUsdc ?? "0",
        toAddress: null as string | null,
        idempotencyKey: idempotencyKey(bountyId, "POOL_PAYOUT", row.id),
        txHash: null as string | null,
        status: "pending" as const,
      })),
    ])
    .onConflictDoNothing();
}

async function seedEmptyPool(db: Db): Promise<void> {
  const split = splitPostFeePool(FACE, 0);
  const bountyId = SEED_V2.emptyPoolBountyId;
  const winnerHash = "mock:0xv21winner52";
  const feeHash = "mock:0xv21fee52";
  const winnerPid = participantId(41);

  await insertFundedBounty(db, {
    id: bountyId,
    issue: 52,
    title: "V2-1 seed: empty pool on #52",
  });
  await insertEscrow(db, {
    id: SEED_V2.emptyEscrowId,
    bountyId,
    payoutTxHash: winnerHash,
    feeTxHash: feeHash,
  });
  await insertWinnerClaim(db, {
    id: SEED_V2.emptyClaimId,
    bountyId,
    issue: 52,
    prNumber: 300,
    payoutUsdc: split.winnerUsdc,
    payoutTxHash: winnerHash,
  });

  await db
    .insert(poolParticipants)
    .values({
      id: winnerPid,
      bountyId,
      githubId: WINNER_GITHUB_ID,
      githubLogin: WINNER_LOGIN,
      userId: HUNTER_ID,
      role: "winner",
      qualifyingPrNumber: 300,
      qualifyingPrCreatedAt: FROZEN_AT,
      qualifyingPrUrl: prUrl(300),
      commitSha: sha("em"),
      frozenAt: FROZEN_AT,
      shareUsdc: split.winnerUsdc,
      payoutAddress: WINNER_PAYOUT,
      payoutTxHash: winnerHash,
    })
    .onConflictDoNothing();

  await db
    .insert(allocationLedger)
    .values([
      {
        id: ledgerId(41),
        bountyId,
        participantId: null,
        kind: "FEE_OUT",
        amountUsdc: split.feeUsdc,
        toAddress: "gb-fee",
        idempotencyKey: idempotencyKey(bountyId, "FEE_OUT", null),
        txHash: feeHash,
        status: "confirmed",
      },
      {
        id: ledgerId(42),
        bountyId,
        participantId: winnerPid,
        kind: "WINNER_PAYOUT",
        amountUsdc: split.winnerUsdc,
        toAddress: WINNER_PAYOUT,
        idempotencyKey: idempotencyKey(bountyId, "WINNER_PAYOUT", winnerPid),
        txHash: winnerHash,
        status: "confirmed",
      },
    ])
    .onConflictDoNothing();
}

async function seedPosterExcluded(db: Db): Promise<void> {
  const split = splitPostFeePool(FACE, 1);
  const bountyId = SEED_V2.posterExcludedBountyId;
  const winnerHash = "mock:0xv21winner53";
  const feeHash = "mock:0xv21fee53";
  const aliceHash = "mock:0xv21alice53";
  const winnerPid = participantId(51);
  const alicePid = participantId(52);

  await insertFundedBounty(db, {
    id: bountyId,
    issue: 53,
    title: "V2-1 seed: poster excluded on #53",
  });
  await insertEscrow(db, {
    id: SEED_V2.posterEscrowId,
    bountyId,
    payoutTxHash: winnerHash,
    feeTxHash: feeHash,
  });
  await insertWinnerClaim(db, {
    id: SEED_V2.posterClaimId,
    bountyId,
    issue: 53,
    prNumber: 400,
    payoutUsdc: split.winnerUsdc,
    payoutTxHash: winnerHash,
  });

  await db
    .insert(poolParticipants)
    .values([
      {
        id: winnerPid,
        bountyId,
        githubId: WINNER_GITHUB_ID,
        githubLogin: WINNER_LOGIN,
        userId: HUNTER_ID,
        role: "winner",
        qualifyingPrNumber: 400,
        qualifyingPrCreatedAt: FROZEN_AT,
        qualifyingPrUrl: prUrl(400),
        commitSha: sha("pw"),
        frozenAt: FROZEN_AT,
        shareUsdc: split.winnerUsdc,
        payoutAddress: WINNER_PAYOUT,
        payoutTxHash: winnerHash,
      },
      {
        id: alicePid,
        bountyId,
        githubId: BigInt(3),
        githubLogin: "alice",
        userId: SEED_V2.aliceId,
        role: "pool",
        qualifyingPrNumber: 20,
        qualifyingPrCreatedAt: new Date("2026-09-17T09:00:00.000Z"),
        qualifyingPrUrl: prUrl(20),
        commitSha: sha("pa"),
        frozenAt: FROZEN_AT,
        shareUsdc: split.eachUsdc ?? "0",
        payoutTxHash: aliceHash,
      },
      {
        id: participantId(53),
        bountyId,
        githubId: POSTER_GITHUB_ID,
        githubLogin: POSTER_LOGIN,
        userId: MAINTAINER_ID,
        role: "excluded_poster",
        qualifyingPrNumber: 8,
        qualifyingPrCreatedAt: new Date("2026-09-17T08:00:00.000Z"),
        qualifyingPrUrl: prUrl(8),
        commitSha: sha("pp"),
        frozenAt: FROZEN_AT,
        shareUsdc: "0",
        skipReason: "poster",
      },
      {
        id: participantId(54),
        bountyId,
        githubId: BigInt(SEED_V2.botGithubId),
        githubLogin: "dependabot[bot]",
        userId: null,
        role: "excluded_bot",
        qualifyingPrNumber: 9,
        qualifyingPrCreatedAt: new Date("2026-09-17T08:30:00.000Z"),
        qualifyingPrUrl: prUrl(9),
        commitSha: sha("pb"),
        frozenAt: FROZEN_AT,
        shareUsdc: "0",
        skipReason: "bot",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(allocationLedger)
    .values([
      {
        id: ledgerId(51),
        bountyId,
        participantId: null,
        kind: "FEE_OUT",
        amountUsdc: split.feeUsdc,
        toAddress: "gb-fee",
        idempotencyKey: idempotencyKey(bountyId, "FEE_OUT", null),
        txHash: feeHash,
        status: "confirmed",
      },
      {
        id: ledgerId(52),
        bountyId,
        participantId: winnerPid,
        kind: "WINNER_PAYOUT",
        amountUsdc: split.winnerUsdc,
        toAddress: WINNER_PAYOUT,
        idempotencyKey: idempotencyKey(bountyId, "WINNER_PAYOUT", winnerPid),
        txHash: winnerHash,
        status: "confirmed",
      },
      {
        id: ledgerId(53),
        bountyId,
        participantId: alicePid,
        kind: "POOL_PAYOUT",
        amountUsdc: split.eachUsdc ?? "0",
        toAddress: POOL_PAYOUT,
        idempotencyKey: idempotencyKey(bountyId, "POOL_PAYOUT", alicePid),
        txHash: aliceHash,
        status: "confirmed",
      },
    ])
    .onConflictDoNothing();
}

async function seedUnlinkedGithubId(db: Db): Promise<void> {
  const split = splitPostFeePool(FACE, 1);
  const bountyId = SEED_V2.unlinkedBountyId;
  const winnerHash = "mock:0xv21winner54";
  const feeHash = "mock:0xv21fee54";
  const winnerPid = participantId(61);
  const unlinkedPid = participantId(62);

  await insertFundedBounty(db, {
    id: bountyId,
    issue: 54,
    title: "V2-1 seed: unlinked github_id on #54",
  });
  await insertEscrow(db, {
    id: SEED_V2.unlinkedEscrowId,
    bountyId,
    payoutTxHash: winnerHash,
    feeTxHash: feeHash,
  });
  await insertWinnerClaim(db, {
    id: SEED_V2.unlinkedClaimId,
    bountyId,
    issue: 54,
    prNumber: 500,
    payoutUsdc: split.winnerUsdc,
    payoutTxHash: winnerHash,
  });

  await db
    .insert(poolParticipants)
    .values([
      {
        id: winnerPid,
        bountyId,
        githubId: WINNER_GITHUB_ID,
        githubLogin: WINNER_LOGIN,
        userId: HUNTER_ID,
        role: "winner",
        qualifyingPrNumber: 500,
        qualifyingPrCreatedAt: FROZEN_AT,
        qualifyingPrUrl: prUrl(500),
        commitSha: sha("uw"),
        frozenAt: FROZEN_AT,
        shareUsdc: split.winnerUsdc,
        payoutAddress: WINNER_PAYOUT,
        payoutTxHash: winnerHash,
      },
      {
        id: unlinkedPid,
        bountyId,
        githubId: BigInt(SEED_V2.unlinkedGithubId),
        githubLogin: "unlinked-hunter",
        userId: null,
        role: "pool",
        qualifyingPrNumber: 30,
        qualifyingPrCreatedAt: new Date("2026-09-17T07:00:00.000Z"),
        qualifyingPrUrl: prUrl(30),
        commitSha: sha("ul"),
        frozenAt: FROZEN_AT,
        shareUsdc: split.eachUsdc ?? "0",
        skipReason: "hunter_not_linked",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(allocationLedger)
    .values([
      {
        id: ledgerId(61),
        bountyId,
        participantId: null,
        kind: "FEE_OUT",
        amountUsdc: split.feeUsdc,
        toAddress: "gb-fee",
        idempotencyKey: idempotencyKey(bountyId, "FEE_OUT", null),
        txHash: feeHash,
        status: "confirmed",
      },
      {
        id: ledgerId(62),
        bountyId,
        participantId: winnerPid,
        kind: "WINNER_PAYOUT",
        amountUsdc: split.winnerUsdc,
        toAddress: WINNER_PAYOUT,
        idempotencyKey: idempotencyKey(bountyId, "WINNER_PAYOUT", winnerPid),
        txHash: winnerHash,
        status: "confirmed",
      },
      {
        id: ledgerId(63),
        bountyId,
        participantId: unlinkedPid,
        kind: "POOL_PAYOUT",
        amountUsdc: split.eachUsdc ?? "0",
        toAddress: null,
        idempotencyKey: idempotencyKey(bountyId, "POOL_PAYOUT", unlinkedPid),
        txHash: null,
        status: "pending",
      },
    ])
    .onConflictDoNothing();
}
