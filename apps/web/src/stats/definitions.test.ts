import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bountyStatusValues } from "../db/schema";
import {
  assemblePlatformStats,
  asCount,
  asUsdc,
  bountyStatusBucket,
  CLOSED_BOUNTY_STATUSES,
  COMPLETED_BOUNTY_STATUSES,
  emptyBountyStatusCounts,
  emptyPlatformStatsAggregates,
  IN_FLIGHT_BOUNTY_STATUSES,
  isTransactedEscrowStatus,
  OUTSTANDING_OPEN_BOUNTY_STATUSES,
  PLATFORM_STATS_BUCKETS,
  PLATFORM_STATS_SCHEMA_VERSION,
  PRODUCT_OPEN_BOUNTY_STATUSES,
  TRANSACTED_ESCROW_STATUSES,
} from "./definitions";

describe("platform stats definitions", () => {
  it("maps every bounty_status into exactly one product bucket", () => {
    const seen = new Set<string>();
    for (const list of Object.values(PLATFORM_STATS_BUCKETS)) {
      for (const status of list) {
        assert.equal(seen.has(status), false, `duplicate bucket membership: ${status}`);
        seen.add(status);
      }
    }
    assert.deepEqual([...seen].sort(), [...bountyStatusValues].sort());

    for (const status of bountyStatusValues) {
      const bucket = bountyStatusBucket(status);
      assert.ok(bucket, `unbucketed status ${status}`);
      assert.ok(PLATFORM_STATS_BUCKETS[bucket].includes(status));
    }
    assert.equal(bountyStatusBucket("not_a_status"), null);
  });

  it("treats product open as pending_fund + funded + claim_locked", () => {
    assert.deepEqual(PRODUCT_OPEN_BOUNTY_STATUSES, [
      "pending_fund",
      "funded",
      "claim_locked",
    ]);
    assert.deepEqual(OUTSTANDING_OPEN_BOUNTY_STATUSES, ["funded", "claim_locked"]);
    assert.deepEqual(COMPLETED_BOUNTY_STATUSES, ["settled", "settled_partial"]);
    assert.deepEqual(CLOSED_BOUNTY_STATUSES, ["refunded", "cancelled", "expired", "void"]);
    assert.deepEqual(IN_FLIGHT_BOUNTY_STATUSES, ["settling", "refunding"]);
  });

  it("counts funded/settled escrow faces as transacted and never fee legs", () => {
    for (const status of TRANSACTED_ESCROW_STATUSES) {
      assert.equal(isTransactedEscrowStatus(status), true);
    }
    assert.equal(isTransactedEscrowStatus("pending"), false);
    assert.equal(isTransactedEscrowStatus("failed"), false);
    assert.equal(isTransactedEscrowStatus("FEE_OUT"), false);
    assert.equal(isTransactedEscrowStatus("fee"), false);
  });

  it("returns zeros on an empty aggregate (empty DB)", () => {
    const now = new Date("2026-09-20T13:00:00.000Z");
    const stats = assemblePlatformStats(emptyPlatformStatsAggregates(), now);
    assert.equal(stats.ok, true);
    assert.equal(stats.schemaVersion, PLATFORM_STATS_SCHEMA_VERSION);
    assert.equal(stats.schemaVersion, 2);
    assert.equal(stats.generatedAt, now.toISOString());
    assert.equal(stats.product, "GitHub Bounties");
    assert.equal(stats.currency, "USDC");
    assert.deepEqual(stats.buckets, PLATFORM_STATS_BUCKETS);
    assert.equal(stats.bounties.total, 0);
    assert.equal(stats.bounties.open, 0);
    assert.equal(stats.bounties.completed, 0);
    assert.equal(stats.bounties.closed, 0);
    assert.equal(stats.bounties.inFlight, 0);
    assert.deepEqual(stats.bounties.byStatus, emptyBountyStatusCounts());
    assert.deepEqual(stats.volumeUsdc, {
      transacted: "0.000000",
      outstandingOpen: "0.000000",
      outstandingInFlight: "0.000000",
      completed: "0.000000",
    });
    assert.deepEqual(stats.developers, { participated: 0, githubLinked: 0 });
    assert.deepEqual(stats.repos, { withBounties: 0, total: 0 });
  });

  it("sums product buckets and open face without adding fee legs", () => {
    const stats = assemblePlatformStats(
      {
        byStatus: {
          pending_fund: 1,
          funded: 2,
          claim_locked: 1,
          settling: 1,
          settled: 3,
          settled_partial: 1,
          refunding: 1,
          refunded: 2,
          cancelled: 1,
          expired: 1,
          void: 1,
        },
        faceByStatus: {
          pending_fund: "25",
          funded: "100.5",
          claim_locked: "10",
          settling: "20",
          settled: "50",
          settled_partial: "5",
          refunding: "8",
          refunded: "12",
        },
        // Face that reached funded/settled money — not 2% fee (2.00 on 100).
        transactedUsdc: "150",
        developersParticipated: 4,
        developersGithubLinked: 7,
        reposWithBounties: 2,
        reposTotal: 3,
      },
      new Date("2026-09-20T00:00:00.000Z"),
    );

    assert.equal(stats.bounties.total, 15);
    assert.equal(stats.bounties.open, 4);
    assert.equal(stats.bounties.completed, 4);
    assert.equal(stats.bounties.closed, 5);
    assert.equal(stats.bounties.inFlight, 2);
    assert.equal(stats.volumeUsdc.transacted, "150.000000");
    assert.equal(stats.volumeUsdc.outstandingOpen, "110.500000");
    assert.equal(stats.volumeUsdc.outstandingInFlight, "33.000000");
    assert.equal(stats.volumeUsdc.completed, "55.000000");
    assert.equal(stats.developers.participated, 4);
    assert.equal(stats.developers.githubLinked, 7);
    assert.equal(stats.repos.withBounties, 2);
    assert.equal(stats.repos.total, 3);
    assert.equal(
      "connected" in stats.repos,
      false,
      "repos.connected was App-install count; V3-0 uses withBounties",
    );
  });

  it("coerces empty / invalid SQL scalars to zero", () => {
    assert.equal(asCount(null), 0);
    assert.equal(asCount("3"), 3);
    assert.equal(asCount(-1), 0);
    assert.equal(asUsdc(null), "0.000000");
    assert.equal(asUsdc(""), "0.000000");
    assert.equal(asUsdc("10"), "10.000000");
  });
});
