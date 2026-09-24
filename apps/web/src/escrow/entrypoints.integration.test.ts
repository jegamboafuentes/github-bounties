import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createBountyFromIssueUrl } from "../bounties/create";
import { fundBounty, topUpBounty } from "../bounties/fund";
import { createDb, type Database } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { allocationLedger, bounties, claims, escrows, repos, users } from "../db/schema";
import { probeCdpEnv } from "./env";
import { createMockRail } from "./rail";

loadDotenvFiles();

const POSTER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HUNTER = "0x1111111111111111111111111111111111111111";
const ATTACKER = "0x9999999999999999999999999999999999999999";

let currentDb: Database | null = null;
let currentUser: { id: string } | null = null;

mock.module("@/auth/protect", {
  namedExports: {
    getCurrentPublicUser: async () => currentUser,
  },
});

mock.module("@/db/runtime", {
  namedExports: {
    getRuntimeDb: () => {
      if (!currentDb) throw new Error("test db is not set");
      return currentDb;
    },
  },
});

mock.module("next/cache", {
  namedExports: {
    revalidatePath: () => {},
  },
});

mock.module("next/navigation", {
  namedExports: {
    redirect: (url: string) => {
      const err = new Error(`REDIRECT ${url}`);
      (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
      throw err;
    },
  },
});

const CDP_KEYS = ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET"] as const;

async function withCdpEnv(run: () => Promise<void>) {
  const previous = CDP_KEYS.map((key) => process.env[key]);
  for (const key of CDP_KEYS) process.env[key] = "test-not-a-real-secret";
  try {
    assert.equal(probeCdpEnv().mode, "cdp");
    await run();
  } finally {
    CDP_KEYS.forEach((key, index) => {
      const value = previous[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

async function fixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const hunterId = randomUUID();
  const attackerId = randomUUID();
  const fullName = `test/entry-${suffix}`;
  await db.insert(users).values([
    {
      id: posterId,
      googleSub: `poster-entry-${suffix}`,
      email: `poster-entry-${suffix}@example.com`,
      displayName: "Poster",
      walletAddress: POSTER,
    },
    {
      id: hunterId,
      googleSub: `hunter-entry-${suffix}`,
      email: `hunter-entry-${suffix}@example.com`,
      displayName: "Hunter",
      walletAddress: HUNTER,
    },
    {
      id: attackerId,
      googleSub: `attacker-entry-${suffix}`,
      email: `attacker-entry-${suffix}@example.com`,
      displayName: "Attacker",
      walletAddress: ATTACKER,
    },
  ]);
  await db.insert(repos).values({
    id: randomUUID(),
    githubRepoId: BigInt(84_000_000 + Number.parseInt(suffix.slice(0, 6), 16)),
    fullName,
    installationId: BigInt(9101),
    connectedByUserId: posterId,
    isActive: true,
  });
  currentDb = db;
  return { db, sql, suffix, posterId, hunterId, attackerId, fullName };
}

function moneyLogs(lines: string[]) {
  return lines.flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as { event?: string };
      return parsed.event === "money_action" ? [parsed as { action?: string; result?: string; destination?: string }] : [];
    } catch {
      return [];
    }
  });
}

describe("settle, refund, fund, and top-up entrypoints", () => {
  it("rejects a settle route body that supplies hunter fields and pays nothing", async () => {
    const { db, sql, posterId, hunterId, attackerId, fullName } = await fixture();
    const rail = createMockRail(probeCdpEnv({}));
    const logs: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      logs.push(String(line));
    };
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/1`,
          amountUsdc: "10",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      await db.insert(claims).values({
        bountyId: created.id,
        hunterUserId: hunterId,
        status: "eligible",
        prNumber: 11,
        payoutAddress: HUNTER,
      });
      currentUser = { id: attackerId };
      const { POST } = await import("../app/api/bounties/[id]/settle/route");
      const res = await POST(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/settle`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-request-id": "settle-attacker" },
          body: JSON.stringify({ hunterUserId: attackerId, hunterPayoutAddress: ATTACKER }),
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      const body = (await res.json()) as { error?: string };
      assert.equal(res.status, 403);
      assert.equal(body.error, "not_settler");
      const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(escrow?.payoutTxHash, null);
      const logged = moneyLogs(logs);
      assert.ok(logged.some((row) => row.action === "settle" && row.result === "not_settler"));
    } finally {
      console.log = original;
      currentUser = null;
      await sql.end({ timeout: 5 });
    }
  });

  it("rejects a poster settle route when there is no eligible claim", async () => {
    const { db, sql, posterId, fullName } = await fixture();
    const rail = createMockRail(probeCdpEnv({}));
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/2`,
          amountUsdc: "8",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      currentUser = { id: posterId };
      const { POST } = await import("../app/api/bounties/[id]/settle/route");
      const res = await POST(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/settle`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hunterUserId: posterId, hunterPayoutAddress: ATTACKER }),
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      const body = (await res.json()) as { error?: string };
      assert.equal(res.status, 400);
      assert.equal(body.error, "not_settleable");
      const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(escrow?.status, "funded");
    } finally {
      currentUser = null;
      await sql.end({ timeout: 5 });
    }
  });

  it("pays the claim address when the poster settle route includes another destination", async () => {
    const { db, sql, posterId, hunterId, fullName } = await fixture();
    const rail = createMockRail(probeCdpEnv({}));
    const logs: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      logs.push(String(line));
    };
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/3`,
          amountUsdc: "10",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      await db.insert(claims).values({
        bountyId: created.id,
        hunterUserId: hunterId,
        status: "eligible",
        prNumber: 12,
        payoutAddress: HUNTER,
      });
      currentUser = { id: posterId };
      const { POST } = await import("../app/api/bounties/[id]/settle/route");
      const res = await POST(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/settle`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-request-id": "settle-poster" },
          body: JSON.stringify({ hunterPayoutAddress: ATTACKER }),
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      assert.equal(res.status, 200);
      const legs = await db
        .select()
        .from(allocationLedger)
        .where(eq(allocationLedger.bountyId, created.id));
      const winner = legs.find((row) => row.kind === "WINNER_PAYOUT");
      const fee = legs.find((row) => row.kind === "FEE_OUT");
      assert.equal(winner?.toAddress, HUNTER);
      assert.notEqual(winner?.toAddress, ATTACKER);
      assert.ok(fee?.txHash);
      const logged = moneyLogs(logs);
      assert.ok(logged.some((row) => row.action === "settle" && row.result === "ok" && row.destination === HUNTER));
      assert.ok(logged.some((row) => row.action === "fee_transfer" && row.result === "ok"));
    } finally {
      console.log = original;
      currentUser = null;
      await sql.end({ timeout: 5 });
    }
  });

  it("returns 403 not_settler when a funder-only user settles an already settled bounty", async () => {
    const { db, sql, posterId, hunterId, attackerId, fullName, suffix } = await fixture();
    const rail = createMockRail(probeCdpEnv({}));
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/8`,
          amountUsdc: "10",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      await topUpBounty(
        created.id,
        attackerId,
        {
          amountUsdc: "1",
          fundTxHash: `0xroutefunder${suffix}000000000000000000000000000000000000000001`,
        },
        db,
        new Date(),
        { rail },
      );
      await db.insert(claims).values({
        bountyId: created.id,
        hunterUserId: hunterId,
        status: "eligible",
        prNumber: 18,
        payoutAddress: HUNTER,
      });
      currentUser = { id: posterId };
      const { POST } = await import("../app/api/bounties/[id]/settle/route");
      const first = await POST(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/settle`, {
          method: "POST",
          headers: { "content-type": "application/json" },
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      assert.equal(first.status, 200);
      const settled = (await first.json()) as { ok?: boolean; payoutTxHash?: string };
      assert.equal(settled.ok, true);
      assert.ok(settled.payoutTxHash);

      currentUser = { id: attackerId };
      const denied = await POST(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/settle`, {
          method: "POST",
          headers: { "content-type": "application/json" },
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      const deniedBody = (await denied.json()) as { ok?: boolean; error?: string };
      assert.equal(denied.status, 403);
      assert.equal(deniedBody.ok, false);
      assert.equal(deniedBody.error, "not_settler");

      currentUser = { id: posterId };
      const retry = await POST(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/settle`, {
          method: "POST",
          headers: { "content-type": "application/json" },
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      const retryBody = (await retry.json()) as { ok?: boolean; payoutTxHash?: string };
      assert.equal(retry.status, 200);
      assert.equal(retryBody.ok, true);
      assert.equal(retryBody.payoutTxHash, settled.payoutTxHash);
    } finally {
      currentUser = null;
      await sql.end({ timeout: 5 });
    }
  });

  it("refund route and cancel action ignore a caller funderAddress", async () => {
    const { db, sql, posterId, fullName } = await fixture();
    const rail = createMockRail(probeCdpEnv({}));
    const logs: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      logs.push(String(line));
    };
    try {
      const created = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/4`,
          amountUsdc: "7",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(created.id, posterId, db, new Date(), { rail });
      currentUser = { id: posterId };
      const { POST } = await import("../app/api/bounties/[id]/refund/route");
      const res = await POST(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/refund`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-request-id": "refund-1" },
          body: JSON.stringify({ funderAddress: ATTACKER }),
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      assert.equal(res.status, 200);
      const [escrow] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(escrow?.funderAddress, POSTER);
      assert.notEqual(escrow?.funderAddress, ATTACKER);
      assert.ok(moneyLogs(logs).some((row) => row.action === "refund" && row.result === "ok" && row.destination === POSTER));

      const second = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/5`,
          amountUsdc: "4",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(second.id, posterId, db, new Date(), { rail });
      const actions = await import("../app/actions/bounties");
      const form = new FormData();
      form.set("bountyId", second.id);
      form.set("funderAddress", ATTACKER);
      await actions.cancelBountyAction(form);
      const [cancelled] = await db.select().from(escrows).where(eq(escrows.bountyId, second.id));
      assert.equal(cancelled?.funderAddress, POSTER);
      const [bounty] = await db.select().from(bounties).where(eq(bounties.id, second.id));
      assert.equal(bounty?.status, "cancelled");
    } finally {
      console.log = original;
      currentUser = null;
      await sql.end({ timeout: 5 });
    }
  });

  it("rejects a pasted hash on the fund route and the fund and top-up actions when the rail is cdp", async () => {
    const { db, sql, posterId, fullName, suffix } = await fixture();
    const rail = createMockRail(probeCdpEnv({}));
    try {
      const pending = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/6`,
          amountUsdc: "5",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      const funded = await createBountyFromIssueUrl(
        {
          posterUserId: posterId,
          issueUrl: `https://github.com/${fullName}/issues/7`,
          amountUsdc: "5",
        },
        { db, fetchIssueSnapshot: async () => null },
      );
      await fundBounty(funded.id, posterId, db, new Date(), { rail });
      currentUser = { id: posterId };
      await withCdpEnv(async () => {
        const { POST } = await import("../app/api/bounties/[id]/fund/route");
        const res = await POST(
          new Request(`https://dev.githubbounties.xyz/api/bounties/${pending.id}/fund`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              fundTxHash: `0xdead${suffix}00000000000000000000000000000000000000000000000001`,
            }),
          }),
          { params: Promise.resolve({ id: pending.id }) },
        );
        const body = (await res.json()) as { error?: string };
        assert.equal(res.status, 400);
        assert.equal(body.error, "fund_hash_not_verified");

        const actions = await import("../app/actions/bounties");
        const fundForm = new FormData();
        fundForm.set("bountyId", pending.id);
        fundForm.set("fundTxHash", `0xdead${suffix}00000000000000000000000000000000000000000000000002`);
        await assert.rejects(
          () => actions.fundBountyAction(fundForm),
          (err: unknown) =>
            err instanceof Error &&
            String((err as { digest?: string }).digest ?? "").includes("fund_hash_not_verified"),
        );

        const topForm = new FormData();
        topForm.set("bountyId", funded.id);
        topForm.set("amountUsdc", "1");
        topForm.set("fundTxHash", `0xtop${suffix}000000000000000000000000000000000000000000000000001`);
        await assert.rejects(
          () => actions.topUpBountyAction(topForm),
          (err: unknown) =>
            err instanceof Error &&
            String((err as { digest?: string }).digest ?? "").includes("fund_hash_not_verified"),
        );
      });
      const [stillPending] = await db.select().from(bounties).where(eq(bounties.id, pending.id));
      const [face] = await db.select().from(bounties).where(eq(bounties.id, funded.id));
      assert.equal(stillPending?.status, "pending_fund");
      assert.equal(face?.amountUsdc, "5.000000");
    } finally {
      currentUser = null;
      await sql.end({ timeout: 5 });
    }
  });
});
