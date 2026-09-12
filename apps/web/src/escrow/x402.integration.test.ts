import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createBountyFromIssueUrl } from "../bounties/create";
import { fundBounty } from "../bounties/fund";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, escrows, repos, users } from "../db/schema";
import { EscrowError } from "./errors";
import { probeCdpEnv } from "./env";
import { recordExactInbound } from "./inbound";
import { getEscrowSnapshot } from "./read";
import { createMockRail, MOCK_ESCROW_ADDRESS } from "./rail";
import { handleX402Fund } from "./x402-http";

loadDotenvFiles();

async function fixture() {
  const { db, sql } = createDb();
  const suffix = randomUUID().slice(0, 8);
  const posterId = randomUUID();
  const repoId = randomUUID();
  const fullName = `test/x402-${suffix}`;
  const githubRepoId = BigInt(81_000_000 + Number.parseInt(suffix.slice(0, 6), 16));

  await db.insert(users).values({
    id: posterId,
    googleSub: `poster-x402-${suffix}`,
    email: `poster-x402-${suffix}@example.com`,
    displayName: "Ada Poster",
    walletAddress: "0x00000000000000000000000000000000f00d01",
  });
  await db.insert(repos).values({
    id: repoId,
    githubRepoId,
    fullName,
    installationId: BigInt(9003),
    connectedByUserId: posterId,
    isActive: true,
  });

  const created = await createBountyFromIssueUrl(
    {
      posterUserId: posterId,
      issueUrl: `https://github.com/${fullName}/issues/7`,
      amountUsdc: "12",
    },
    { db, fetchIssueSnapshot: async () => null },
  );

  return { db, sql, posterId, created };
}

describe("x402 exact inbound → Lock without paste-hash", () => {
  it("records inbound then Lock succeeds on a live-like rail without pasted hash", async () => {
    const { db, sql, posterId, created } = await fixture();
    const liveLike = createMockRail(probeCdpEnv({}));
    const orig = liveLike.lockFace.bind(liveLike);
    liveLike.lockFace = async (input) => {
      if (!input.fundTxHash?.trim()) {
        throw new EscrowError(
          "inbound_unconfirmed",
          "Send face USDC then retry — test live-like rail.",
        );
      }
      return orig(input);
    };
    try {
      await recordExactInbound(db, {
        bountyId: created.id,
        txHash: "0xabc123x402exact000000000000000000000000000000000000000000000001",
        x402PaymentId: "x402:0xabc123",
        escrowAddress: MOCK_ESCROW_ADDRESS,
        resourceUrl: `https://dev.githubbounties.xyz/api/bounties/${created.id}/x402`,
      });

      const snap = await getEscrowSnapshot(created.id, db);
      assert.equal(snap?.inboundRecorded, true);
      assert.equal(snap?.x402.scheme, "exact");
      assert.equal(snap?.x402.hostedCheckout, false);
      assert.equal(snap?.status, "pending");

      const funded = await fundBounty(created.id, posterId, db, new Date(), { rail: liveLike });
      assert.equal(funded.status, "funded");
      assert.equal(
        funded.fundTxHash,
        "0xabc123x402exact000000000000000000000000000000000000000000000001",
      );

      const [row] = await db.select().from(escrows).where(eq(escrows.bountyId, created.id));
      assert.equal(row?.status, "funded");
      assert.equal(row?.x402PaymentId, "x402:0xabc123");
      assert.equal(row?.fundTxHash, funded.fundTxHash);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("GET unpaid is 402 exact; mock rail refuses to fake a settle; live seller records inbound", async () => {
    const { db, sql, posterId, created } = await fixture();
    const mockRail = createMockRail(probeCdpEnv({}));
    const cdpLike = createMockRail(probeCdpEnv({}));
    (cdpLike as { mode: "cdp" }).mode = "cdp";
    cdpLike.missingEnv = [];
    try {
      const unpaid = await handleX402Fund(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/x402`),
        created.id,
        { db, rail: mockRail, env: { PUBLIC_BASE_URL: "https://dev.githubbounties.xyz" } },
      );
      assert.equal(unpaid.status, 402);
      const body = unpaid.body as { accepts?: { scheme?: string; amount?: string; payTo?: string }[] };
      assert.equal(body.accepts?.[0]?.scheme, "exact");
      assert.equal(body.accepts?.[0]?.amount, "12000000");
      assert.equal(body.accepts?.[0]?.payTo, MOCK_ESCROW_ADDRESS);
      assert.ok(unpaid.headers["PAYMENT-REQUIRED"]);

      const mockPaid = await handleX402Fund(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/x402`, {
          method: "POST",
          headers: { "PAYMENT-SIGNATURE": "fake" },
        }),
        created.id,
        { db, rail: mockRail },
      );
      assert.equal(mockPaid.status, 400);
      assert.equal((mockPaid.body as { error?: string }).error, "x402_facilitator_unavailable");

      const paid = await handleX402Fund(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/x402`, {
          method: "POST",
          headers: { "PAYMENT-SIGNATURE": "sig" },
        }),
        created.id,
        {
          db,
          rail: cdpLike,
          env: { PUBLIC_BASE_URL: "https://dev.githubbounties.xyz" },
          liveSeller: async () => ({
            kind: "settled",
            settled: {
              status: 200,
              headers: { "PAYMENT-RESPONSE": "ok" },
              txHash: "0xfeedface00000000000000000000000000000000000000000000000000000001",
              payer: "0x00000000000000000000000000000000f00d01",
            },
          }),
        },
      );
      assert.equal(paid.status, 200);
      assert.equal((paid.body as { inboundRecorded?: boolean }).inboundRecorded, true);

      const replay = await handleX402Fund(
        new Request(`https://dev.githubbounties.xyz/api/bounties/${created.id}/x402`),
        created.id,
        { db, rail: cdpLike },
      );
      assert.equal(replay.status, 200);
      assert.equal((replay.body as { inboundRecorded?: boolean }).inboundRecorded, true);

      const funded = await fundBounty(created.id, posterId, db, new Date(), { rail: cdpLike });
      assert.equal(funded.status, "funded");
      assert.equal(
        funded.fundTxHash,
        "0xfeedface00000000000000000000000000000000000000000000000000000001",
      );

      const [bounty] = await db.select().from(bounties).where(eq(bounties.id, created.id));
      assert.equal(bounty?.status, "funded");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("keeps pasted fundTxHash working without an x402 inbound", async () => {
    const { db, sql, posterId, created } = await fixture();
    const rail = createMockRail(probeCdpEnv({}));
    try {
      const funded = await fundBounty(created.id, posterId, db, new Date(), {
        rail,
        fundTxHash: "0xpasted00000000000000000000000000000000000000000000000000000001",
      });
      assert.equal(
        funded.fundTxHash,
        "0xpasted00000000000000000000000000000000000000000000000000000001",
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
