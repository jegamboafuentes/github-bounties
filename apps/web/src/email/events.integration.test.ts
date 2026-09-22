import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { createBountyFromIssueUrl } from "../bounties/create";
import { fundBounty } from "../bounties/fund";
import { ClaimError } from "../claims/errors";
import { claimPoolPayout, claimPayout } from "../claims/payout";
import { createDb, type Database } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import {
  bounties,
  claims,
  emailOutbox,
  githubLinks,
  poolParticipants,
  repos,
  users,
} from "../db/schema";
import { EscrowError } from "../escrow/errors";
import { probeCdpEnv } from "../escrow/env";
import { createMockRail } from "../escrow/rail";
import { formatUsdc } from "../bounties/display";
import { splitPostFeePool } from "../lib/money";
import type { TransactionalEmailAdapter } from "./adapter";
import { backfillUnlinkedPoolParticipants } from "../webhooks/pool";
import { markEligibleClaims } from "../webhooks/claims";
import type { EligibilityDecision, GitHubWebhookPayload } from "../webhooks/types";
import {
  bountyFundedIdempotencyKey,
  bountySettledIdempotencyKey,
  poolClaimableIdempotencyKey,
  prMergedIdempotencyKey,
} from "./templates";

loadDotenvFiles();

const HUNTER_ADDRESS = "0x1111111111111111111111111111111111111111";
const ALICE_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB_ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SILENT = { env: {} } as const;

function githubId(): bigint {
  return BigInt(`0x${randomUUID().replace(/-/g, "").slice(0, 12)}`);
}

function countingAdapter(sends: string[]): TransactionalEmailAdapter {
  return {
    async send(message) {
      sends.push(message.idempotencyKey);
      return { ok: true, providerMessageId: `msg-${sends.length}` };
    },
  };
}

async function fixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const hunterId = randomUUID();
  const fullName = `test/mail-${suffix}`;
  const posterEmail = `poster-${suffix}@example.com`;
  const hunterEmail = `hunter-${suffix}@example.com`;
  await db.insert(users).values([
    {
      id: posterId,
      googleSub: `poster-${suffix}`,
      email: posterEmail,
      displayName: "Ada Poster",
    },
    {
      id: hunterId,
      googleSub: `hunter-${suffix}`,
      email: hunterEmail,
      displayName: "Hunter One",
    },
  ]);
  await db.insert(repos).values({
    githubRepoId: githubId(),
    fullName,
    installationId: BigInt(9003),
    connectedByUserId: posterId,
    isActive: true,
  });
  const rail = createMockRail(probeCdpEnv({}));
  return { db, sql, suffix, posterId, hunterId, fullName, posterEmail, hunterEmail, rail };
}

async function post(
  db: Database,
  posterId: string,
  fullName: string,
  issue: number,
  amount = "100",
) {
  return createBountyFromIssueUrl(
    {
      posterUserId: posterId,
      issueUrl: `https://github.com/${fullName}/issues/${issue}`,
      amountUsdc: amount,
      title: `Issue ${issue}`,
    },
    { db, fetchIssueSnapshot: async () => null },
  );
}

async function rowsFor(
  db: Database,
  userId: string,
  template?: string,
) {
  const where = template
    ? and(eq(emailOutbox.userId, userId), eq(emailOutbox.template, template))
    : eq(emailOutbox.userId, userId);
  return db.select().from(emailOutbox).where(where);
}

describe("domain email events", () => {
  it("enqueues bounty_funded once after lock, not on a failed lock, and does not double-send", async () => {
    const { db, sql, posterId, fullName, posterEmail, rail } = await fixture();
    const sends: string[] = [];
    const email = { env: {}, adapter: countingAdapter(sends) };
    const failing = createMockRail(probeCdpEnv({}));
    failing.lockFace = async () => {
      throw new EscrowError("rail_failed", "simulated CDP transfer() missing");
    };
    try {
      const created = await post(db, posterId, fullName, 11, "50");
      assert.equal((await rowsFor(db, posterId, "bounty_funded")).length, 0);

      await assert.rejects(
        () => fundBounty(created.id, posterId, db, new Date(), { rail: failing, email }),
        (err: unknown) => err instanceof EscrowError && err.code === "rail_failed",
      );
      assert.equal(sends.length, 0);
      assert.equal((await rowsFor(db, posterId)).length, 0);
      const [stillPending] = await db.select().from(bounties).where(eq(bounties.id, created.id));
      assert.equal(stillPending?.status, "pending_fund");

      const funded = await fundBounty(created.id, posterId, db, new Date(), { rail, email });
      assert.equal(funded.status, "funded");
      assert.deepEqual(sends, [bountyFundedIdempotencyKey(created.id)]);

      const [row] = await rowsFor(db, posterId, "bounty_funded");
      assert.equal(row?.status, "sent");
      assert.equal(row?.toEmail, posterEmail);
      assert.equal(row?.payload?.amountLabel, "50 USDC");
      assert.equal(row?.payload?.repoFullName, fullName);
      assert.equal(row?.payload?.issueNumber, 11);
      assert.equal(row?.payload?.bountyTitle, "Issue 11");
      assert.match(row?.payload?.bountyUrl ?? "", new RegExp(`/bounties/${created.id}$`));

      await assert.rejects(
        () => fundBounty(created.id, posterId, db, new Date(), { rail, email }),
        (err: unknown) => err instanceof EscrowError && err.code === "not_fundable",
      );
      assert.equal(sends.length, 1);
      assert.equal((await rowsFor(db, posterId, "bounty_funded")).length, 1);
      const [bounty] = await db.select().from(bounties).where(eq(bounties.id, created.id));
      assert.equal(bounty?.status, "funded");
      assert.equal(bounty?.amountUsdc, "50.000000");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("skips a blank or noreply funder and leaves pending mail when Resend is unset", async () => {
    const { db, sql, posterId, fullName, rail } = await fixture();
    const suffix = randomUUID().slice(0, 8);
    try {
      await db.update(users).set({ email: "   " }).where(eq(users.id, posterId));
      const blankBounty = await post(db, posterId, fullName, 12, "10");
      const funded = await fundBounty(blankBounty.id, posterId, db, new Date(), {
        rail,
        email: SILENT,
      });
      assert.equal(funded.status, "funded");
      assert.equal((await rowsFor(db, posterId)).length, 0);

      const noreplyId = randomUUID();
      await db.insert(users).values({
        id: noreplyId,
        googleSub: `noreply-${suffix}`,
        email: "real-then-noreply@example.com",
        displayName: "Noreply",
      });
      await db
        .update(users)
        .set({ email: "123+ada@users.noreply.github.com" })
        .where(eq(users.id, noreplyId));
      await db.insert(repos).values({
        githubRepoId: githubId(),
        fullName: `test/noreply-${suffix}`,
        installationId: BigInt(9004),
        connectedByUserId: noreplyId,
        isActive: true,
      });
      const noreplyBounty = await post(db, noreplyId, `test/noreply-${suffix}`, 1, "10");
      const noreplyFunded = await fundBounty(noreplyBounty.id, noreplyId, db, new Date(), {
        rail,
        email: SILENT,
      });
      assert.equal(noreplyFunded.status, "funded");
      assert.equal((await rowsFor(db, noreplyId)).length, 0);

      const quietId = randomUUID();
      const quietEmail = `quiet-${suffix}@example.com`;
      await db.insert(users).values({
        id: quietId,
        googleSub: `quiet-${suffix}`,
        email: quietEmail,
        displayName: "Quiet",
      });
      await db.insert(repos).values({
        githubRepoId: githubId(),
        fullName: `test/quiet-${suffix}`,
        installationId: BigInt(9005),
        connectedByUserId: quietId,
        isActive: true,
      });
      const quietBounty = await post(db, quietId, `test/quiet-${suffix}`, 2, "25");
      const quietFunded = await fundBounty(quietBounty.id, quietId, db, new Date(), {
        rail,
        email: SILENT,
      });
      assert.equal(quietFunded.status, "funded");
      const [pending] = await rowsFor(db, quietId, "bounty_funded");
      assert.equal(pending?.status, "pending");
      assert.equal(pending?.attemptCount, 0);
      assert.equal(pending?.providerMessageId, null);
      assert.equal(pending?.toEmail, quietEmail);

      const throwing: TransactionalEmailAdapter = {
        async send() {
          throw new Error("resend down");
        },
      };
      const retryBounty = await post(db, quietId, `test/quiet-${suffix}`, 3, "25");
      const stillFunded = await fundBounty(retryBounty.id, quietId, db, new Date(), {
        rail,
        email: { env: {}, adapter: throwing },
      });
      assert.equal(stillFunded.status, "funded");
      const [retried] = await db
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.idempotencyKey, bountyFundedIdempotencyKey(retryBounty.id)));
      assert.equal(retried?.status, "pending");
      assert.match(retried?.lastError ?? "", /resend down/);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("enqueues pr_merged once when a merged PR becomes winner-eligible", async () => {
    const { db, sql, posterId, hunterId, fullName, hunterEmail, suffix } = await fixture();
    const login = `winner-${suffix}`;
    const winnerGithubId = githubId();
    try {
      await db.insert(githubLinks).values({
        userId: hunterId,
        githubId: winnerGithubId,
        githubLogin: login,
      });
      const created = await post(db, posterId, fullName, 21, "40");
      await db
        .update(bounties)
        .set({ status: "funded", fundedAt: new Date() })
        .where(eq(bounties.id, created.id));

      const skipped = await markEligibleClaims(
        {
          eligible: false,
          reason: "not merged",
          closedIssueNumbers: [],
          repositoryFullName: fullName,
        },
        {},
        db,
        SILENT,
      );
      assert.equal(skipped.length, 0);
      assert.equal((await rowsFor(db, hunterId)).length, 0);

      const decision: EligibilityDecision = {
        eligible: true,
        reason: "merged PR closes funded issue",
        closedIssueNumbers: [21],
        winnerLogin: login,
        winnerId: Number(winnerGithubId),
        pullRequestNumber: 210,
        repositoryFullName: fullName,
      };
      const payload: GitHubWebhookPayload = {
        pull_request: {
          number: 210,
          html_url: `https://github.com/${fullName}/pull/210`,
          merged_at: "2026-09-22T00:00:00Z",
          user: { login, id: Number(winnerGithubId) },
        },
      };

      const first = await markEligibleClaims(decision, payload, db, SILENT);
      const second = await markEligibleClaims(decision, payload, db, SILENT);
      assert.equal(first[0]?.status, "eligible");
      assert.equal(second[0]?.claimId, first[0]?.claimId);
      const mailed = await rowsFor(db, hunterId, "pr_merged");
      assert.equal(mailed.length, 1);
      assert.equal(mailed[0]?.idempotencyKey, prMergedIdempotencyKey(first[0]!.claimId!));
      assert.equal(mailed[0]?.toEmail, hunterEmail);
      assert.equal(mailed[0]?.status, "pending");
      assert.equal(mailed[0]?.payload?.amountLabel, "40 USDC");
      assert.equal(mailed[0]?.payload?.bountyTitle, "Issue 21");
      const [claim] = await db.select().from(claims).where(eq(claims.id, first[0]!.claimId!));
      assert.equal(claim?.status, "eligible");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("writes the eligible claim when the winner has no sendable signup email", async () => {
    const { db, sql, posterId, hunterId, fullName, suffix } = await fixture();
    const login = `blank-${suffix}`;
    try {
      await db.update(users).set({ email: "   " }).where(eq(users.id, hunterId));
      await db.insert(githubLinks).values({
        userId: hunterId,
        githubId: githubId(),
        githubLogin: login,
      });
      const created = await post(db, posterId, fullName, 22, "15");
      await db
        .update(bounties)
        .set({ status: "funded", fundedAt: new Date() })
        .where(eq(bounties.id, created.id));
      const written = await markEligibleClaims(
        {
          eligible: true,
          reason: "merged",
          closedIssueNumbers: [22],
          winnerLogin: login,
          pullRequestNumber: 220,
          repositoryFullName: fullName,
        },
        { pull_request: { number: 220, user: { login } } },
        db,
        SILENT,
      );
      assert.equal(written[0]?.status, "eligible");
      assert.equal((await rowsFor(db, hunterId)).length, 0);

      const noreplyId = randomUUID();
      const noreplyLogin = `noreply-${suffix}`;
      await db.insert(users).values({
        id: noreplyId,
        googleSub: `noreply-hunter-${suffix}`,
        email: "placeholder@example.com",
        displayName: "Noreply Hunter",
      });
      await db
        .update(users)
        .set({ email: "9+hunter@noreply.github.com" })
        .where(eq(users.id, noreplyId));
      await db.insert(githubLinks).values({
        userId: noreplyId,
        githubId: githubId(),
        githubLogin: noreplyLogin,
      });
      const other = await post(db, posterId, fullName, 23, "15");
      await db
        .update(bounties)
        .set({ status: "funded", fundedAt: new Date() })
        .where(eq(bounties.id, other.id));
      const noreplyWritten = await markEligibleClaims(
        {
          eligible: true,
          reason: "merged",
          closedIssueNumbers: [23],
          winnerLogin: noreplyLogin,
          pullRequestNumber: 230,
          repositoryFullName: fullName,
        },
        { pull_request: { number: 230, user: { login: noreplyLogin } } },
        db,
        SILENT,
      );
      assert.equal(noreplyWritten[0]?.status, "eligible");
      assert.equal((await rowsFor(db, noreplyId)).length, 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("enqueues winner settlement and pool claimable once, without paying the pool", async () => {
    const fx = await fixture();
    const { db, sql, posterId, hunterId, fullName, rail } = fx;
    const suffix = fx.suffix;
    const aliceId = randomUUID();
    const bobId = randomUUID();
    const aliceEmail = `alice-${suffix}@example.com`;
    const bobEmail = `bob-${suffix}@example.com`;
    try {
      await db.insert(users).values([
        {
          id: aliceId,
          googleSub: `alice-${suffix}`,
          email: aliceEmail,
          displayName: "Alice",
        },
        {
          id: bobId,
          googleSub: `bob-${suffix}`,
          email: bobEmail,
          displayName: "Bob",
        },
      ]);
      const created = await post(db, posterId, fullName, 31, "100");
      await fundBounty(created.id, posterId, db, new Date(), { rail, email: SILENT });
      const [claim] = await db
        .insert(claims)
        .values({
          bountyId: created.id,
          hunterUserId: hunterId,
          status: "eligible",
          prNumber: 310,
          prAuthorLogin: "winner",
        })
        .returning();
      assert.ok(claim);

      const split = splitPostFeePool(created.amountUsdc, 3);
      if (!split.eachUsdc) throw new Error("expected a pool share");
      const eachUsdc = split.eachUsdc;
      const frozenAt = new Date("2026-09-22T00:00:00.000Z");
      await db.insert(poolParticipants).values([
        {
          bountyId: created.id,
          githubId: githubId(),
          githubLogin: "winner",
          userId: hunterId,
          role: "winner",
          frozenAt,
          shareUsdc: split.winnerUsdc,
          payoutAddress: HUNTER_ADDRESS,
        },
        {
          bountyId: created.id,
          githubId: githubId(),
          githubLogin: "alice",
          userId: aliceId,
          role: "pool",
          frozenAt,
          shareUsdc: eachUsdc,
          payoutAddress: ALICE_ADDRESS,
        },
        {
          bountyId: created.id,
          githubId: githubId(),
          githubLogin: "bob",
          userId: bobId,
          role: "pool",
          frozenAt,
          shareUsdc: eachUsdc,
          payoutAddress: BOB_ADDRESS,
        },
        {
          bountyId: created.id,
          githubId: githubId(),
          githubLogin: "overflow",
          role: "overflow",
          frozenAt,
          shareUsdc: "0",
          skipReason: "overflow",
        },
      ]);

      assert.equal((await rowsFor(db, hunterId, "bounty_settled")).length, 0);
      assert.equal((await rowsFor(db, aliceId, "pool_claimable")).length, 0);

      await assert.rejects(
        () =>
          claimPayout(
            created.id,
            hunterId,
            { payoutAddress: "not-an-address", claimId: claim.id },
            { db, rail, email: SILENT },
          ),
        (err: unknown) => err instanceof ClaimError && err.code === "invalid_payout_address",
      );
      assert.equal((await rowsFor(db, hunterId, "bounty_settled")).length, 0);

      const paid = await claimPayout(
        created.id,
        hunterId,
        { payoutAddress: HUNTER_ADDRESS, claimId: claim.id },
        { db, rail, email: SILENT },
      );
      assert.equal(paid.bountyStatus, "settled_partial");
      assert.equal(paid.hunterUsdc, split.winnerUsdc);
      assert.equal(paid.feeUsdc, split.feeUsdc);
      assert.equal(paid.winnerUsdc, split.winnerUsdc);

      const [settledMail] = await rowsFor(db, hunterId, "bounty_settled");
      assert.equal(settledMail?.status, "pending");
      assert.equal(settledMail?.attemptCount, 0);
      assert.equal(settledMail?.idempotencyKey, bountySettledIdempotencyKey(claim.id));
      assert.equal(settledMail?.payload?.amountLabel, `${formatUsdc(split.winnerUsdc)} USDC`);
      assert.match(settledMail?.payload?.bountyUrl ?? "", /\/bounties\//);

      const aliceMail = await rowsFor(db, aliceId, "pool_claimable");
      const bobMail = await rowsFor(db, bobId, "pool_claimable");
      assert.equal(aliceMail.length, 1);
      assert.equal(bobMail.length, 1);
      assert.equal(aliceMail[0]?.toEmail, aliceEmail);
      assert.equal(aliceMail[0]?.payload?.amountLabel, `${formatUsdc(eachUsdc)} USDC`);
      assert.equal((await rowsFor(db, hunterId, "pool_claimable")).length, 0);
      assert.equal((await rowsFor(db, posterId, "pool_claimable")).length, 0);

      const members = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.bountyId, created.id));
      const alice = members.find((row) => row.userId === aliceId);
      const bob = members.find((row) => row.userId === bobId);
      const overflow = members.find((row) => row.role === "overflow");
      assert.ok(alice && bob);
      assert.equal(alice.payoutTxHash, null);
      assert.equal(bob.payoutTxHash, null);
      assert.equal(alice.shareUsdc, eachUsdc);
      assert.equal(bob.shareUsdc, eachUsdc);
      assert.equal(overflow?.shareUsdc, "0.000000");
      assert.equal(aliceMail[0]?.idempotencyKey, poolClaimableIdempotencyKey(created.id, alice.id));

      const again = await claimPayout(
        created.id,
        hunterId,
        { payoutAddress: HUNTER_ADDRESS, claimId: claim.id },
        { db, rail, email: SILENT },
      );
      assert.equal(again.payoutTxHash, paid.payoutTxHash);
      assert.equal(again.hunterUsdc, paid.hunterUsdc);
      assert.equal((await rowsFor(db, hunterId, "bounty_settled")).length, 1);
      assert.equal((await rowsFor(db, aliceId, "pool_claimable")).length, 1);
      assert.equal((await rowsFor(db, bobId, "pool_claimable")).length, 1);

      const alicePaid = await claimPoolPayout(
        created.id,
        aliceId,
        { payoutAddress: ALICE_ADDRESS, participantId: alice.id },
        { db, rail, email: SILENT },
      );
      assert.equal(alicePaid.participantId, alice.id);
      assert.equal(alicePaid.poolShareUsdc, eachUsdc);
      assert.equal(alicePaid.bountyStatus, "settled_partial");
      const [aliceAfter] = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.id, alice.id));
      const [bobAfter] = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.id, bob.id));
      assert.ok(aliceAfter?.payoutTxHash);
      assert.equal(bobAfter?.payoutTxHash, null);
      assert.equal(bobAfter?.shareUsdc, eachUsdc);
      assert.equal((await rowsFor(db, aliceId, "pool_claimable")).length, 1);
      assert.equal((await rowsFor(db, bobId, "pool_claimable")).length, 1);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("emails a pool participant only after their share is claimable and they have a signup user", async () => {
    const { db, sql, posterId, hunterId, fullName, rail, suffix } = await fixture();
    const earlyId = randomUUID();
    const lateId = randomUUID();
    const earlyGithub = githubId();
    const lateGithub = githubId();
    const earlyLogin = `early-${suffix}`;
    const lateLogin = `late-${suffix}`;
    try {
      await db.insert(users).values([
        {
          id: earlyId,
          googleSub: `early-${suffix}`,
          email: `early-${suffix}@example.com`,
          displayName: "Early",
        },
        {
          id: lateId,
          googleSub: `late-${suffix}`,
          email: `late-${suffix}@example.com`,
          displayName: "Late",
        },
      ]);
      await db.insert(githubLinks).values([
        { userId: earlyId, githubId: earlyGithub, githubLogin: earlyLogin },
        { userId: lateId, githubId: lateGithub, githubLogin: lateLogin },
      ]);
      const created = await post(db, posterId, fullName, 41, "100");
      await fundBounty(created.id, posterId, db, new Date(), { rail, email: SILENT });
      const [claim] = await db
        .insert(claims)
        .values({
          bountyId: created.id,
          hunterUserId: hunterId,
          status: "eligible",
          prNumber: 410,
          prAuthorLogin: "winner",
        })
        .returning();
      assert.ok(claim);
      const split = splitPostFeePool(created.amountUsdc, 2);
      if (!split.eachUsdc) throw new Error("expected a pool share");
      const eachUsdc = split.eachUsdc;
      const frozenAt = new Date("2026-09-22T00:00:00.000Z");
      const [earlyRow] = await db
        .insert(poolParticipants)
        .values({
          bountyId: created.id,
          githubId: earlyGithub,
          githubLogin: earlyLogin,
          userId: null,
          role: "pool",
          frozenAt,
          shareUsdc: eachUsdc,
          skipReason: "hunter_not_linked",
        })
        .returning();
      const [lateRow] = await db
        .insert(poolParticipants)
        .values({
          bountyId: created.id,
          githubId: lateGithub,
          githubLogin: lateLogin,
          userId: null,
          role: "pool",
          frozenAt,
          shareUsdc: eachUsdc,
          skipReason: "hunter_not_linked",
        })
        .returning();
      assert.ok(earlyRow && lateRow);

      const linkedEarly = await backfillUnlinkedPoolParticipants(
        { userId: earlyId, githubLogin: earlyLogin, githubId: earlyGithub },
        db,
        SILENT,
      );
      assert.equal(linkedEarly, 1);
      assert.equal((await rowsFor(db, earlyId)).length, 0);

      const paid = await claimPayout(
        created.id,
        hunterId,
        { payoutAddress: HUNTER_ADDRESS, claimId: claim.id },
        { db, rail, email: SILENT },
      );
      assert.equal(paid.bountyStatus, "settled_partial");
      assert.equal(paid.hunterUsdc, split.winnerUsdc);
      assert.equal((await rowsFor(db, earlyId, "pool_claimable")).length, 1);
      assert.equal((await rowsFor(db, lateId)).length, 0);
      const [earlyAfterClaim] = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.id, earlyRow.id));
      assert.equal(earlyAfterClaim?.payoutTxHash, null);
      assert.equal(earlyAfterClaim?.userId, earlyId);

      const linkedLate = await backfillUnlinkedPoolParticipants(
        { userId: lateId, githubLogin: lateLogin, githubId: lateGithub },
        db,
        SILENT,
      );
      assert.equal(linkedLate, 1);
      const lateMail = await rowsFor(db, lateId, "pool_claimable");
      assert.equal(lateMail.length, 1);
      assert.equal(lateMail[0]?.idempotencyKey, poolClaimableIdempotencyKey(created.id, lateRow.id));
      assert.equal(lateMail[0]?.payload?.amountLabel, `${formatUsdc(eachUsdc)} USDC`);
      assert.equal(lateMail[0]?.status, "pending");

      const linkedLateAgain = await backfillUnlinkedPoolParticipants(
        { userId: lateId, githubLogin: lateLogin, githubId: lateGithub },
        db,
        SILENT,
      );
      assert.equal(linkedLateAgain, 0);
      assert.equal((await rowsFor(db, lateId, "pool_claimable")).length, 1);
      const [lateAfter] = await db
        .select()
        .from(poolParticipants)
        .where(eq(poolParticipants.id, lateRow.id));
      assert.equal(lateAfter?.payoutTxHash, null);
      assert.equal(lateAfter?.shareUsdc, eachUsdc);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
