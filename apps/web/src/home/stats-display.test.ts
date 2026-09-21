import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemblePlatformStats, emptyPlatformStatsAggregates } from "../stats";
import {
  formatStatCount,
  formatTransactedVolumeUsdc,
  homepageStatCards,
  HOMEPAGE_STAT_KEYS,
} from "./stats-display";

describe("homepage stats display", () => {
  it("maps FE-0 fields with docs/stats.md labels", () => {
    const stats = assemblePlatformStats(
      {
        ...emptyPlatformStatsAggregates(),
        byStatus: { pending_fund: 1, funded: 2, settled: 3, refunded: 4 },
        transactedUsdc: "150.5",
        developersParticipated: 6,
        reposWithBounties: 2,
      },
      new Date("2026-09-20T00:00:00.000Z"),
    );

    const cards = homepageStatCards(stats);
    const byKey = Object.fromEntries(cards.map((card) => [card.key, card]));

    assert.deepEqual(
      cards.map((card) => card.key),
      [...HOMEPAGE_STAT_KEYS],
    );
    assert.equal(byKey["bounties.total"]?.label, "Bounties");
    assert.equal(byKey["bounties.total"]?.value, "10");
    assert.equal(byKey["bounties.open"]?.label, "Open");
    assert.equal(byKey["bounties.open"]?.value, "3");
    assert.match(byKey["bounties.open"]?.hint ?? "", /pending_fund \+ funded \+ claim_locked/);
    assert.equal(byKey["bounties.completed"]?.label, "Completed");
    assert.equal(byKey["bounties.completed"]?.value, "3");
    assert.equal(byKey["bounties.closed"]?.label, "Closed");
    assert.equal(byKey["bounties.closed"]?.value, "4");
    assert.equal(byKey["volumeUsdc.transacted"]?.label, "USDC volume");
    assert.equal(byKey["volumeUsdc.transacted"]?.value, "150.5 USDC");
    assert.match(byKey["volumeUsdc.transacted"]?.hint ?? "", /Excludes fees/);
    assert.equal(byKey["developers.participated"]?.label, "Developers");
    assert.equal(byKey["developers.participated"]?.value, "6");
    assert.equal(byKey["repos.withBounties"]?.label, "Repos with bounties");
    assert.equal(byKey["repos.withBounties"]?.value, "2");
    assert.match(byKey["repos.withBounties"]?.hint ?? "", /Not bare GitHub App installs/);
    assert.equal(byKey["repos.connected"], undefined);
  });

  it("formats empty-DB zeros the same way GET /api/stats does", () => {
    const cards = homepageStatCards(assemblePlatformStats(emptyPlatformStatsAggregates()));
    assert.equal(formatStatCount(0), "0");
    assert.equal(formatTransactedVolumeUsdc("0.000000"), "0 USDC");
    assert.equal(
      cards.find((card) => card.key === "volumeUsdc.transacted")?.value,
      "0 USDC",
    );
  });
});
