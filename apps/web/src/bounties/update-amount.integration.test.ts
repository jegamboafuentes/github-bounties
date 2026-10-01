import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bountyAmountChanges, bountyContributions, bounties, claims, escrows, repos, users } from "../db/schema";
import { getPoolRoster } from "./roster";
import { signalWorkingOnThis } from "./signals";
import { createBountyFromIssueUrl } from "./create";
import { fundBounty } from "./fund";
import { BountyError } from "./errors";
import { updateBountyAmount } from "./update-amount";

loadDotenvFiles();

async function fixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const otherId = randomUUID();
  const repoId = randomUUID();
  const fullName = `test/amount-${suffix}`;
  await db.insert(users).values([
    {
      id: posterId,
      googleSub: `poster-amt-${suffix}`,
      email: `poster-amt-${suffix}@example.com`,
      displayName: "Ada Poster",
    },
    {
      id: otherId,
      googleSub: `other-amt-${suffix}`,
      email: `other-amt-${suffix}@example.com`,
      displayName: "Other User",
    },
  ]);
  await db.insert(repos).values({
    id: repoId,
    githubRepoId: BigInt(70_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
    fullName,
    installationId: BigInt(9013),
    connectedByUserId: posterId,
    isActive: true,
  });
  return { db, sql, suffix, posterId, otherId, fullName };
}

async function post(db: Awaited<ReturnType<typeof fixture>>["db"], posterId: string, fullName: string, n: number, amount = "10") {
  return createBountyFromIssueUrl(
    {
      posterUserId: posterId,
      issueUrl: `https://github.com/${fullName}/issues/${n}`,
      amountUsdc: amount,
    },
    { db, fetchIssueSnapshot: async () => null },
  );
}

function codeOf(err: unknown): string {
  return err instanceof BountyError ? err.code : "other";
}

describe("updateBountyAmount", () => {
  it("lets the poster change an unfunded face, writes the audit row, and updates the payout preview", async () => {
    const { db, sql, posterId, otherId, fullName } = await fixture();
    const lines: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      const created = await post(db, posterId, fullName, 13, "10");
      await signalWorkingOnThis(created.id, otherId, db);
      await db.insert(claims).values({
        bountyId: created.id,
        hunterUserId: otherId,
        status: "eligible",
      });

      await assert.rejects(
        () =>
          updateBountyAmount({
            bountyId: created.id,
            actorUserId: otherId,
            amountUsdc: "20",
            source: "web",
            db,
          }),
        (err: unknown) => codeOf(err) === "not_poster",
      );

      const updated = await updateBountyAmount({
        bountyId: created.id,
        actorUserId: posterId,
        amountUsdc: "25.5",
        source: "rest",
        apiKeyId: null,
        db,
      });
      assert.equal(updated.oldAmountUsdc, "10.000000");
      assert.equal(updated.newAmountUsdc, "25.500000");
      assert.equal(updated.status, "pending_fund");

      const [bounty] = await db.select().from(bounties).where(eq(bounties.id, created.id)).limit(1);
      const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id)).limit(1);
      assert.equal(bounty?.amountUsdc, "25.500000");
      assert.equal(escrow?.amountUsdc, "25.500000");
      assert.equal(escrow?.status, "pending");

      const audits = await db.select().from(bountyAmountChanges).where(eq(bountyAmountChanges.bountyId, created.id));
      assert.equal(audits.length, 1);
      assert.equal(audits[0]?.oldAmountUsdc, "10.000000");
      assert.equal(audits[0]?.newAmountUsdc, "25.500000");
      assert.equal(audits[0]?.actorUserId, posterId);
      assert.equal(audits[0]?.source, "rest");
      assert.equal(audits[0]?.apiKeyId, null);

      const roster = await getPoolRoster(created.id, db);
      assert.equal(roster?.breakdown.faceUsdc, "25.500000");

      const logged = lines
        .map((line) => {
          try {
            return JSON.parse(line) as { event?: string; newAmountUsdc?: string; source?: string };
          } catch {
            return null;
          }
        })
        .filter((row) => row?.event === "bounty_amount_changed");
      assert.equal(logged.length, 1);
      assert.equal(logged[0]?.newAmountUsdc, "25.500000");
      assert.equal(logged[0]?.source, "rest");

      await assert.rejects(
        () =>
          updateBountyAmount({
            bountyId: created.id,
            actorUserId: posterId,
            amountUsdc: "25.50",
            source: "web",
            db,
          }),
        (err: unknown) => codeOf(err) === "amount_unchanged",
      );
      await assert.rejects(
        () =>
          updateBountyAmount({
            bountyId: created.id,
            actorUserId: posterId,
            amountUsdc: "0",
            source: "mcp",
            db,
          }),
        (err: unknown) => codeOf(err) === "invalid_amount",
      );
      await assert.rejects(
        () =>
          updateBountyAmount({
            bountyId: created.id,
            actorUserId: posterId,
            amountUsdc: "1.0000001",
            source: "mcp",
            db,
          }),
        (err: unknown) => codeOf(err) === "invalid_amount",
      );
    } finally {
      console.log = original;
      await sql.end({ timeout: 5 });
    }
  });

  it("refuses a funded bounty and a pending x402 lock", async () => {
    const { db, sql, posterId, fullName } = await fixture();
    try {
      const funded = await post(db, posterId, fullName, 14, "8");
      await fundBounty(funded.id, posterId, db);
      await assert.rejects(
        () =>
          updateBountyAmount({
            bountyId: funded.id,
            actorUserId: posterId,
            amountUsdc: "9",
            source: "web",
            db,
          }),
        (err: unknown) => codeOf(err) === "bounty_has_funds",
      );

      const pendingLock = await post(db, posterId, fullName, 15, "8");
      await db
        .update(escrows)
        .set({
          fundTxHash: `0x${pendingLock.id.replace(/-/g, "")}000000000000000000000000`,
          x402PaymentId: `x402:${pendingLock.id}`,
        })
        .where(eq(escrows.bountyId, pendingLock.id));
      await assert.rejects(
        () =>
          updateBountyAmount({
            bountyId: pendingLock.id,
            actorUserId: posterId,
            amountUsdc: "9",
            source: "web",
            db,
          }),
        (err: unknown) => codeOf(err) === "bounty_has_funds",
      );

      const contributed = await post(db, posterId, fullName, 16, "8");
      await db.insert(bountyContributions).values({
        bountyId: contributed.id,
        funderUserId: posterId,
        amountUsdc: "8.000000",
        fundTxHash: `0x${contributed.id.replace(/-/g, "")}aaaaaaaaaaaaaaaaaaaaaaaa`,
      });
      await assert.rejects(
        () =>
          updateBountyAmount({
            bountyId: contributed.id,
            actorUserId: posterId,
            amountUsdc: "9",
            source: "mcp",
            db,
          }),
        (err: unknown) => codeOf(err) === "bounty_has_funds",
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("rejects a face above 1,000,000 and a never-funded cancelled or settled bounty", async () => {
    const { db, sql, posterId, fullName } = await fixture();
    try {
      await assert.rejects(
        () => post(db, posterId, fullName, 17, "1000000000000000"),
        (err: unknown) => codeOf(err) === "invalid_amount",
      );
      const open = await post(db, posterId, fullName, 18, "10");
      await assert.rejects(
        () =>
          updateBountyAmount({
            bountyId: open.id,
            actorUserId: posterId,
            amountUsdc: "1000000000000000",
            source: "rest",
            db,
          }),
        (err: unknown) => {
          assert.ok(err instanceof BountyError);
          assert.equal(err.code, "invalid_amount");
          assert.match(err.message, /1,000,000 USDC/);
          return true;
        },
      );
      const [unchanged] = await db.select().from(bounties).where(eq(bounties.id, open.id)).limit(1);
      assert.equal(unchanged?.amountUsdc, "10.000000");
      assert.equal(unchanged?.status, "pending_fund");

      const capped = await updateBountyAmount({
        bountyId: open.id,
        actorUserId: posterId,
        amountUsdc: "1000000",
        source: "web",
        db,
      });
      assert.equal(capped.newAmountUsdc, "1000000.000000");

      for (const [issue, status] of [
        [19, "cancelled"],
        [20, "settled"],
      ] as const) {
        const draft = await post(db, posterId, fullName, issue, "8");
        await db.update(bounties).set({ status }).where(eq(bounties.id, draft.id));
        await assert.rejects(
          () =>
            updateBountyAmount({
              bountyId: draft.id,
              actorUserId: posterId,
              amountUsdc: "9",
              source: "mcp",
              db,
            }),
          (err: unknown) => codeOf(err) === "bounty_not_editable",
        );
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
