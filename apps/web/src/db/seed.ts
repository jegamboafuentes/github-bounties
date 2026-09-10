import { eq } from "drizzle-orm";
import { CLAIM_LOCK_HOURS, FEE_BPS } from "../lib/constants";
import { claimLockExpiresAt, feeFromFaceUsdc } from "../lib/money";
import { createDb } from "./client";
import { loadDotenvFiles } from "./load-dotenv";
import {
  bounties,
  claimLocks,
  claims,
  escrows,
  feeLedger,
  githubLinks,
  repos,
  users,
} from "./schema";

loadDotenvFiles();

/** Stable ids so the seed is idempotent. */
export const SEED = {
  maintainerId: "00000000-0000-4000-8000-000000000001",
  hunterId: "00000000-0000-4000-8000-000000000002",
  repoId: "00000000-0000-4000-8000-000000000010",
  pendingBountyId: "00000000-0000-4000-8000-000000000021",
  fundedBountyId: "00000000-0000-4000-8000-000000000022",
  unlockedBountyId: "00000000-0000-4000-8000-000000000023",
  settledBountyId: "00000000-0000-4000-8000-000000000024",
  escrowId: "00000000-0000-4000-8000-000000000031",
  settledEscrowId: "00000000-0000-4000-8000-000000000032",
  lockId: "00000000-0000-4000-8000-000000000041",
  claimId: "00000000-0000-4000-8000-000000000051",
  settledClaimId: "00000000-0000-4000-8000-000000000052",
  feeId: "00000000-0000-4000-8000-000000000061",
  settledFeeId: "00000000-0000-4000-8000-000000000062",
} as const;

async function main() {
  const { db, sql } = createDb();
  try {
    await db
      .insert(users)
      .values([
        {
          id: SEED.maintainerId,
          googleSub: "seed-google-maintainer",
          email: "maintainer@example.com",
          displayName: "Ada Maintainer",
          walletAddress: null,
        },
        {
          id: SEED.hunterId,
          googleSub: "seed-google-hunter",
          email: "hunter@example.com",
          displayName: "Hunter Example",
          walletAddress: "0x0000000000000000000000000000000000000001",
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(githubLinks)
      .values([
        {
          userId: SEED.maintainerId,
          githubId: BigInt(1),
          githubLogin: "ada-maintainer",
        },
        {
          userId: SEED.hunterId,
          githubId: BigInt(2),
          githubLogin: "octocat",
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(repos)
      .values({
        id: SEED.repoId,
        githubRepoId: BigInt(1_296_269),
        fullName: "octo/hello",
        installationId: BigInt(4242),
        connectedByUserId: SEED.maintainerId,
        isActive: true,
      })
      .onConflictDoNothing();

    await db
      .insert(bounties)
      .values({
        id: SEED.pendingBountyId,
        repoId: SEED.repoId,
        githubIssueNumber: 41,
        url: "https://github.com/octo/hello/issues/41",
        posterUserId: SEED.maintainerId,
        amountUsdc: "25.000000",
        currency: "USDC",
        chain: "base",
        status: "pending_fund",
        title: "Seed: pending_fund bounty on #41",
        descriptionSnapshot: "Sample issue snapshot. Not funded yet.",
      })
      .onConflictDoNothing();

    const fundedAt = new Date();
    await db
      .insert(bounties)
      .values({
        id: SEED.fundedBountyId,
        repoId: SEED.repoId,
        githubIssueNumber: 42,
        url: "https://github.com/octo/hello/issues/42",
        posterUserId: SEED.maintainerId,
        amountUsdc: "100.000000",
        currency: "USDC",
        chain: "base",
        status: "claim_locked",
        title: "Seed: claim-locked bounty on #42",
        descriptionSnapshot: "Fixes welcome. Winner = merged PR author that closes #42.",
        fundedAt,
      })
      .onConflictDoUpdate({
        target: bounties.id,
        set: {
          status: "claim_locked",
          title: "Seed: claim-locked bounty on #42",
          fundedAt,
          updatedAt: fundedAt,
        },
      });

    await db
      .insert(bounties)
      .values({
        id: SEED.unlockedBountyId,
        repoId: SEED.repoId,
        githubIssueNumber: 43,
        url: "https://github.com/octo/hello/issues/43",
        posterUserId: SEED.maintainerId,
        amountUsdc: "40.000000",
        currency: "USDC",
        chain: "base",
        status: "funded",
        title: "Seed: open funded bounty on #43",
        descriptionSnapshot: "Unlocked. Hunters can take the 72h claim-lock.",
        fundedAt,
      })
      .onConflictDoNothing();

    const settledAt = new Date();
    await db
      .insert(bounties)
      .values({
        id: SEED.settledBountyId,
        repoId: SEED.repoId,
        githubIssueNumber: 44,
        url: "https://github.com/octo/hello/issues/44",
        posterUserId: SEED.maintainerId,
        amountUsdc: "50.000000",
        currency: "USDC",
        chain: "base",
        status: "settled",
        title: "Seed: completed (paid) bounty on #44",
        descriptionSnapshot: "Merged and paid. Poster/board see completed.",
        fundedAt,
      })
      .onConflictDoUpdate({
        target: bounties.id,
        set: {
          status: "settled",
          title: "Seed: completed (paid) bounty on #44",
          fundedAt,
          updatedAt: settledAt,
        },
      });

    await db
      .insert(escrows)
      .values({
        id: SEED.escrowId,
        bountyId: SEED.fundedBountyId,
        amountUsdc: "100.000000",
        status: "funded",
        x402PaymentId: null,
        x402Url: null,
        checkoutId: null,
        fundTxHash: null,
        escrowAddress: null,
        funderAddress: null,
      })
      .onConflictDoNothing();

    const lockedAt = new Date();
    const lockExpires = claimLockExpiresAt(lockedAt, CLAIM_LOCK_HOURS);
    await db
      .insert(claimLocks)
      .values({
        id: SEED.lockId,
        bountyId: SEED.fundedBountyId,
        hunterUserId: SEED.hunterId,
        lockedAt,
        expiresAt: lockExpires,
        status: "active",
      })
      .onConflictDoUpdate({
        target: claimLocks.id,
        set: {
          hunterUserId: SEED.hunterId,
          lockedAt,
          expiresAt: lockExpires,
          status: "active",
          updatedAt: lockedAt,
        },
      });

    await db
      .insert(claims)
      .values({
        id: SEED.claimId,
        bountyId: SEED.fundedBountyId,
        hunterUserId: SEED.hunterId,
        status: "eligible",
        prNumber: 15,
        prUrl: "https://github.com/octo/hello/pull/15",
        prAuthorLogin: "octocat",
        closedIssueNumber: 42,
      })
      .onConflictDoNothing();

    await db
      .insert(feeLedger)
      .values({
        id: SEED.feeId,
        bountyId: SEED.fundedBountyId,
        faceUsdc: "100.000000",
        feeUsdc: feeFromFaceUsdc("100.000000", FEE_BPS),
        feeBps: FEE_BPS,
        settledAt: null,
      })
      .onConflictDoNothing();

    await db
      .insert(escrows)
      .values({
        id: SEED.settledEscrowId,
        bountyId: SEED.settledBountyId,
        amountUsdc: "50.000000",
        status: "settled",
        fundTxHash: "mock:0xseedfund44",
        payoutTxHash: "mock:0xseedpayout44",
        feeTxHash: "mock:0xseedfee44",
        escrowAddress: "0x00000000000000000000000000000000000e5c00",
      })
      .onConflictDoNothing();

    await db
      .insert(claims)
      .values({
        id: SEED.settledClaimId,
        bountyId: SEED.settledBountyId,
        hunterUserId: SEED.hunterId,
        status: "paid",
        prNumber: 18,
        prUrl: "https://github.com/octo/hello/pull/18",
        prAuthorLogin: "octocat",
        closedIssueNumber: 44,
        payoutAddress: "0x0000000000000000000000000000000000000001",
        payoutUsdc: "49.000000",
        payoutTxHash: "mock:0xseedpayout44",
        paidAt: settledAt,
      })
      .onConflictDoNothing();

    await db
      .insert(feeLedger)
      .values({
        id: SEED.settledFeeId,
        bountyId: SEED.settledBountyId,
        faceUsdc: "50.000000",
        feeUsdc: feeFromFaceUsdc("50.000000", FEE_BPS),
        feeBps: FEE_BPS,
        settledAt,
      })
      .onConflictDoNothing();

    const [funded] = await db
      .select({
        id: bounties.id,
        status: bounties.status,
        amountUsdc: bounties.amountUsdc,
      })
      .from(bounties)
      .where(eq(bounties.id, SEED.fundedBountyId))
      .limit(1);

    const [lock] = await db
      .select({
        expiresAt: claimLocks.expiresAt,
        lockedAt: claimLocks.lockedAt,
      })
      .from(claimLocks)
      .where(eq(claimLocks.id, SEED.lockId))
      .limit(1);

    const [fee] = await db
      .select({
        feeBps: feeLedger.feeBps,
        feeUsdc: feeLedger.feeUsdc,
      })
      .from(feeLedger)
      .where(eq(feeLedger.id, SEED.feeId))
      .limit(1);

    console.log("Seed complete.");
    console.log(`  users: maintainer + hunter`);
    console.log(`  repo: octo/hello`);
    console.log(`  bounty pending_fund: ${SEED.pendingBountyId} (#41)`);
    console.log(`  bounty funded (unlocked): ${SEED.unlockedBountyId} (#43)`);
    console.log(`  bounty settled/paid: ${SEED.settledBountyId} (#44)`);
    console.log(
      `  bounty funded: ${funded?.id ?? SEED.fundedBountyId} status=${funded?.status} amount_usdc=${funded?.amountUsdc}`,
    );
    if (lock?.lockedAt && lock.expiresAt) {
      const hours =
        (lock.expiresAt.getTime() - lock.lockedAt.getTime()) / 3_600_000;
      console.log(`  claim-lock: ${hours}h (expected ${CLAIM_LOCK_HOURS})`);
    }
    console.log(
      `  fee_ledger: fee_bps=${fee?.feeBps} fee_usdc=${fee?.feeUsdc} (2% of 100)`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
