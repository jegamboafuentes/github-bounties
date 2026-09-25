import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { poolPayoutBreakdown } from "../../bounties/display";
import type { BoardBounty } from "../../bounties/list";
import { countPaidPayoutLegs, type PoolRosterView } from "../../bounties/roster";
import type { BountyContributionView } from "../../escrow/top-up";
import {
  confirmedTotalFor,
  contributionAmountsFromQuery,
  sumConfirmedContributionAmounts,
  sumConfirmedFundedAmounts,
  ZERO_FUNDED_USDC,
} from "./funded";
import {
  orderContributionsNewestFirst,
  presentBountyDetail,
  presentFunderList,
  presentFundingTransactions,
  presentPublicBounty,
  usdcWire,
} from "./present";

const BOUNTY_ID = "e057886a-1241-4b60-a0a5-e8eee7e7b10e";

function board(partial: Partial<BoardBounty> & Pick<BoardBounty, "status" | "amountUsdc">): BoardBounty {
  return {
    id: BOUNTY_ID,
    title: "Issue",
    url: "https://github.com/android/architecture-samples/issues/1080",
    currency: "USDC",
    githubIssueNumber: 1080,
    repoFullName: "android/architecture-samples",
    posterDisplayName: "Enrique Gamboa",
    posterUserId: "user-1",
    posterGithubLogin: "enrique-lb",
    funders: [],
    funderCount: 0,
    fundedAt: null,
    createdAt: new Date("2026-09-24T18:35:49.830Z"),
    activeLock: null,
    workSignals: [],
    payout: null,
    pendingHunterLink: null,
    escrowFail: null,
    intelligence: null,
    ...partial,
  };
}

function roster(faceUsdc: string): PoolRosterView {
  const split = poolPayoutBreakdown(faceUsdc, 0);
  return {
    frozen: false,
    frozenAt: null,
    winner: null,
    pool: [],
    overflow: [],
    overflowCount: 0,
    overflowCaption: null,
    excludedPoster: null,
    candidates: [],
    eligibilityFreezeCopy: "Eligibility freezes at the winning merge.",
    breakdown: {
      faceUsdc: split.faceUsdc,
      feeUsdc: split.feeUsdc,
      winnerUsdc: split.winnerUsdc,
      poolTotalUsdc: split.poolTotalUsdc,
      eachUsdc: split.eachUsdc,
      eligibleCount: split.eligibleCount,
      paidCount: 0,
      emptyPool: split.emptyPool,
      winnerShareLabel: "100% of post-fee",
      poolShareLabel: "0",
      feeTxHash: null,
      winnerTxHash: null,
    },
    legs: [],
  };
}

function contribution(
  partial: Partial<BountyContributionView> & Pick<BountyContributionView, "id" | "createdAt" | "amountUsdc">,
): BountyContributionView {
  return {
    funderUserId: "user-1",
    displayName: "Ada",
    githubLogin: "ada",
    funderAddress: "0xabcsecretwallet",
    fundTxHash: "0xfund",
    refundTxHash: null,
    avatarUrl: null,
    ...partial,
  };
}

describe("confirmed funded total", () => {
  it("sums only contributions with a recorded fund tx and formats six decimals", () => {
    const totals = sumConfirmedContributionAmounts([
      { bountyId: "a", amountUsdc: "1.000000", fundTxHash: "0x1" },
      { bountyId: "a", amountUsdc: "0.500000", fundTxHash: "0x2" },
      { bountyId: "a", amountUsdc: "9.000000", fundTxHash: "   " },
      { bountyId: "a", amountUsdc: "9.000000", fundTxHash: null },
      { bountyId: "a", amountUsdc: "2.250000", fundTxHash: "0xrefunded" },
      { bountyId: "b", amountUsdc: "3", fundTxHash: "0x3" },
    ]);
    assert.equal(totals.get("a"), "3.750000");
    assert.equal(totals.get("b"), "3.000000");
    assert.equal(confirmedTotalFor(totals, "missing"), ZERO_FUNDED_USDC);
    assert.equal(confirmedTotalFor(new Map(), BOUNTY_ID), "0.000000");
  });

  it("reads query rows and ignores a blank fund tx without reading a wallet column", () => {
    const rows = contributionAmountsFromQuery({
      rows: [
        { bounty_id: "a", amount_usdc: "1.500000", fund_tx_hash: "0x1", funder_address: "0xshouldnotmatter" },
        { bounty_id: "a", amount_usdc: "4.000000", fund_tx_hash: "   " },
        { bounty_id: "b", amount_usdc: 2, fund_tx_hash: "0x2" },
      ],
    });
    assert.equal(rows[0]?.fundTxHash, "0x1");
    assert.equal(JSON.stringify(rows).includes("0xshouldnotmatter"), false);
    assert.equal(sumConfirmedContributionAmounts(rows).get("a"), "1.500000");
    assert.equal(sumConfirmedContributionAmounts(rows).get("b"), "2.000000");
  });

  it("counts a legacy settled escrow fund with no contributions as the face", () => {
    const totals = sumConfirmedFundedAmounts(
      [],
      [{ bountyId: "legacy", amountUsdc: "10.000000", fundTxHash: "0xlegacy" }],
    );
    assert.equal(totals.get("legacy"), "10.000000");
    const presented = presentPublicBounty(
      board({ status: "settled", amountUsdc: "10.000000" }),
      confirmedTotalFor(totals, "legacy"),
    );
    assert.equal(presented.totalFundedUsdc, "10.000000");
    assert.equal(presented.amountUsdc, "10.000000");
    assert.equal(presented.payout.faceUsdc, "10.000000");
  });

  it("counts an original lock and a top-up once when the escrow hash is the lock", () => {
    const totals = sumConfirmedFundedAmounts(
      [
        { bountyId: "crowd", amountUsdc: "10.000000", fundTxHash: "0xAbC" },
        { bountyId: "crowd", amountUsdc: "5.000000", fundTxHash: "0xtop" },
        { bountyId: "crowd", amountUsdc: "10.000000", fundTxHash: "0xabc" },
      ],
      [{ bountyId: "crowd", amountUsdc: "15.000000", fundTxHash: "0xabc" }],
    );
    assert.equal(totals.get("crowd"), "15.000000");
    const presented = presentPublicBounty(
      board({ status: "funded", amountUsdc: "15.000000" }),
      confirmedTotalFor(totals, "crowd"),
    );
    assert.equal(presented.totalFundedUsdc, "15.000000");
    assert.equal(presented.amountUsdc, "15.000000");
    assert.equal(presented.payout.faceUsdc, "15.000000");
  });

  it("does not add the rewritten escrow face on top of a top-up that omits the lock hash", () => {
    const totals = sumConfirmedFundedAmounts(
      [{ bountyId: "top", amountUsdc: "5.000000", fundTxHash: "0xtop" }],
      [{ bountyId: "top", amountUsdc: "15.000000", fundTxHash: "0xlock" }],
    );
    assert.equal(totals.get("top"), "15.000000");
  });

  it("returns 0.000000 for pending_fund when the escrow has no fund transaction", () => {
    const totals = sumConfirmedFundedAmounts(
      [{ bountyId: BOUNTY_ID, amountUsdc: "9.000000", fundTxHash: "   " }],
      [{ bountyId: BOUNTY_ID, amountUsdc: "1.000000", fundTxHash: null }],
    );
    assert.equal(confirmedTotalFor(totals, BOUNTY_ID), "0.000000");
    const presented = presentPublicBounty(
      board({ status: "pending_fund", amountUsdc: "1.000000", funderCount: 0 }),
      confirmedTotalFor(totals, BOUNTY_ID),
    );
    assert.equal(presented.status, "pending_fund");
    assert.equal(presented.totalFundedUsdc, "0.000000");
    assert.equal(presented.amountUsdc, "1.000000");
    assert.equal(presented.payout.faceUsdc, "1.000000");
  });

  it("reports a cancelled bounty's verified escrow fund and keeps the face", () => {
    const totals = sumConfirmedFundedAmounts(
      [],
      [{ bountyId: BOUNTY_ID, amountUsdc: "4.500000", fundTxHash: "0xcancel" }],
    );
    const presented = presentPublicBounty(
      board({ status: "cancelled", amountUsdc: "10.000000" }),
      confirmedTotalFor(totals, BOUNTY_ID),
    );
    assert.equal(presented.status, "cancelled");
    assert.equal(presented.totalFundedUsdc, "4.500000");
    assert.equal(presented.amountUsdc, "10.000000");
    assert.equal(presented.payout.faceUsdc, "10.000000");
  });

  it("uses 0.000000 for an unfunded bounty and keeps the face on amountUsdc", () => {
    const presented = presentPublicBounty(
      board({
        status: "pending_fund",
        amountUsdc: "1.000000",
        funderCount: 0,
      }),
      "0",
    );
    assert.equal(presented.status, "pending_fund");
    assert.equal(presented.fundedAt, null);
    assert.equal(presented.amountUsdc, "1.000000");
    assert.equal(presented.totalFundedUsdc, "0.000000");
    assert.equal(presented.payout.faceUsdc, "1.000000");
    assert.equal(presented.funders.count, 0);
    assert.equal(usdcWire("0"), "0.000000");
  });

  it("keeps cancelled and refunded status while totalFundedUsdc is the confirmed sum, not the face", () => {
    const cases = [
      ["cancelled", "10.000000", "4.500000"],
      ["refunded", "10.000000", "7.000000"],
      ["refunding", "8.000000", "8.000000"],
      ["expired", "2.000000", "0.000000"],
    ] as const;
    for (const [status, face, funded] of cases) {
      const list = presentPublicBounty(board({ status, amountUsdc: face }), funded);
      assert.equal(list.status, status);
      assert.equal(list.amountUsdc, face);
      assert.equal(list.totalFundedUsdc, funded);
      assert.equal(list.payout.faceUsdc, face);

      const detail = presentBountyDetail({
        bounty: board({ status, amountUsdc: face }),
        totalFundedUsdc: funded,
        issueBody: null,
        roster: roster(face),
        escrow: null,
      });
      assert.equal(detail.bounty.status, status);
      assert.equal(detail.bounty.amountUsdc, face);
      assert.equal(detail.bounty.totalFundedUsdc, funded);
      assert.equal(detail.bounty.payout.faceUsdc, face);
    }
  });

  it("returns an empty work-signal list for a cancelled bounty and keeps signals when open", () => {
    const signaledAt = new Date("2026-09-01T00:00:00.000Z");
    const signal = {
      id: "sig-1",
      bountyId: BOUNTY_ID,
      userId: "user-2",
      githubLogin: "octocat",
      hunterLabel: "octocat",
      signaledAt,
    };
    const cancelled = presentBountyDetail({
      bounty: board({ status: "cancelled", amountUsdc: "10.000000", workSignals: [signal] }),
      totalFundedUsdc: "10.000000",
      issueBody: null,
      roster: roster("10.000000"),
      escrow: null,
    });
    assert.deepEqual(cancelled.workSignals, []);

    const funded = presentBountyDetail({
      bounty: board({ status: "funded", amountUsdc: "10.000000", workSignals: [signal] }),
      totalFundedUsdc: "10.000000",
      issueBody: null,
      roster: roster("10.000000"),
      escrow: null,
    });
    assert.deepEqual(funded.workSignals, [
      {
        githubLogin: "octocat",
        hunterLabel: "octocat",
        signaledAt: signaledAt.toISOString(),
      },
    ]);
  });

  it("counts paid winner and pool legs and skips the fee leg", () => {
    const base = roster("1.100000");
    const paid: PoolRosterView = {
      ...base,
      winner: {
        id: "winner",
        githubLogin: "octocat",
        githubId: "1",
        userId: "user-1",
        role: "winner",
        qualifyingPrNumber: 1,
        qualifyingPrUrl: null,
        shareUsdc: "0.916300",
        payoutTxHash: "0xwinner",
        skipReason: null,
        frozen: true,
        unlinked: false,
        paid: true,
      },
      pool: [
        {
          id: "pool",
          githubLogin: "alice",
          githubId: "2",
          userId: "user-2",
          role: "pool",
          qualifyingPrNumber: 2,
          qualifyingPrUrl: null,
          shareUsdc: "0.161700",
          payoutTxHash: "0xpool",
          skipReason: null,
          frozen: true,
          unlinked: false,
          paid: true,
        },
      ],
      breakdown: {
        ...base.breakdown,
        paidCount: 1,
        winnerTxHash: "0xwinner",
      },
      legs: [
        { kind: "FEE_OUT", participantId: null, amountUsdc: "0.022000", txHash: "0xfee", status: "confirmed", githubLogin: null },
        { kind: "WINNER_PAYOUT", participantId: "winner", amountUsdc: "0.916300", txHash: "0xwinner", status: "confirmed", githubLogin: "octocat" },
        { kind: "POOL_PAYOUT", participantId: "pool", amountUsdc: "0.161700", txHash: "0xpool", status: "confirmed", githubLogin: "alice" },
      ],
    };
    assert.equal(countPaidPayoutLegs(paid), 2);
    const detail = presentBountyDetail({
      bounty: board({ status: "settled", amountUsdc: "1.100000" }),
      totalFundedUsdc: "1.100000",
      issueBody: null,
      roster: paid,
      escrow: null,
    });
    assert.equal(detail.bounty.payout.paidCount, 2);
    assert.equal(paid.breakdown.paidCount, 1);
  });
});

describe("shared roster payout", () => {
  it("uses the detail roster schedule and split on the list", () => {
    const face = "100.000000";
    const split = poolPayoutBreakdown(face, 2);
    const view = roster(face);
    view.breakdown = {
      ...view.breakdown,
      faceUsdc: split.faceUsdc,
      feeUsdc: split.feeUsdc,
      winnerUsdc: split.winnerUsdc,
      poolTotalUsdc: split.poolTotalUsdc,
      eachUsdc: split.eachUsdc,
      eligibleCount: split.eligibleCount,
      emptyPool: split.emptyPool,
    };
    const bounty = board({ status: "funded", amountUsdc: face });
    const list = presentPublicBounty(bounty, face, view);
    const detail = presentBountyDetail({
      bounty,
      totalFundedUsdc: face,
      issueBody: null,
      roster: view,
      escrow: null,
    });
    assert.equal(list.payout.schedule, "roster");
    assert.equal(detail.bounty.payout.schedule, "roster");
    assert.equal(list.payout.emptyPool, false);
    assert.equal(list.payout.winnerUsdc, detail.bounty.payout.winnerUsdc);
    assert.equal(list.payout.poolTotalUsdc, detail.bounty.payout.poolTotalUsdc);
    assert.equal(list.payout.feeUsdc, detail.bounty.payout.feeUsdc);
    assert.equal(list.payout.eachUsdc, detail.bounty.payout.eachUsdc);

    const empty = presentPublicBounty(board({ status: "funded", amountUsdc: "10.000000" }), "10.000000");
    const emptyDetail = presentBountyDetail({
      bounty: board({ status: "funded", amountUsdc: "10.000000" }),
      totalFundedUsdc: "10.000000",
      issueBody: null,
      roster: roster("10.000000"),
      escrow: null,
    });
    assert.equal(empty.payout.schedule, "roster");
    assert.equal(empty.payout.emptyPool, true);
    assert.equal(emptyDetail.bounty.payout.schedule, "roster");
    assert.equal(empty.payout.winnerUsdc, emptyDetail.bounty.payout.winnerUsdc);
    assert.equal(empty.payout.poolTotalUsdc, "0.000000");
  });
});

describe("public funding transactions", () => {
  it("lists the fund and later top-ups with explorer links and no wallets", () => {
    const fund = `0x${"ab".repeat(32)}`;
    const topUp = `0x${"cd".repeat(32)}`;
    const detail = presentBountyDetail({
      bounty: board({ status: "funded", amountUsdc: "14.500000" }),
      totalFundedUsdc: "14.500000",
      issueBody: null,
      roster: roster("14.500000"),
      escrow: null,
      mainnet: false,
      contributions: [
        { amountUsdc: "10.000000", fundTxHash: fund, createdAt: new Date("2026-09-01T00:00:00.000Z") },
        { amountUsdc: "4.500000", fundTxHash: topUp, createdAt: new Date("2026-09-02T00:00:00.000Z") },
        { amountUsdc: "1.000000", fundTxHash: "not-a-hash", createdAt: new Date("2026-09-03T00:00:00.000Z") },
      ],
    });
    assert.deepEqual(
      detail.funding.map((row) => row.kind),
      ["fund", "top_up", "top_up"],
    );
    assert.equal(detail.funding[0]?.txHash, fund);
    assert.equal(detail.funding[1]?.amountUsdc, "4.500000");
    assert.match(detail.funding[1]?.explorerUrl ?? "", /^https:\/\/sepolia\.basescan\.org\/tx\/0xcd/);
    assert.equal(detail.funding[2]?.explorerUrl, null);
    const json = JSON.stringify(detail.funding);
    assert.equal(json.includes("funderAddress"), false);
    assert.equal(json.includes("wallet"), false);

    const mainnet = presentFundingTransactions({
      contributions: [{ amountUsdc: "1", fundTxHash: fund, createdAt: new Date("2026-09-01T00:00:00.000Z") }],
      escrowFundTxHash: fund,
      escrowAmountUsdc: "1",
      mainnet: true,
    });
    assert.equal(mainnet[0]?.kind, "fund");
    assert.match(mainnet[0]?.explorerUrl ?? "", /^https:\/\/basescan\.org\/tx\//);
    assert.doesNotMatch(mainnet[0]?.explorerUrl ?? "", /sepolia/);
  });
});

describe("funder order", () => {
  it("keeps avatar order newest first, matching the board stack", () => {
    const presented = presentPublicBounty(
      board({
        status: "funded",
        amountUsdc: "3.000000",
        funderCount: 2,
        funders: [
          { userId: "new", displayName: "Nina", avatarUrl: "https://example.com/nina.png" },
          { userId: "old", displayName: "Ada", avatarUrl: null },
        ],
      }),
      "3.000000",
    );
    assert.deepEqual(
      presented.funders.avatars.map((funder) => funder.displayName),
      ["Nina", "Ada"],
    );
  });

  it("lists contributions newest first and omits wallet addresses", () => {
    const older = contribution({
      id: "00000000-0000-4000-8000-000000000001",
      displayName: "Ada",
      amountUsdc: "1.000000",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      funderAddress: "0xada-wallet",
    });
    const newer = contribution({
      id: "00000000-0000-4000-8000-000000000002",
      displayName: "Nina",
      amountUsdc: "2.000000",
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
      funderAddress: "0xnina-wallet",
      fundTxHash: "0xnewer",
    });
    const tiedLaterId = contribution({
      id: "00000000-0000-4000-8000-000000000003",
      displayName: "Tied high",
      amountUsdc: "0.250000",
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
    });
    const listed = presentFunderList(BOUNTY_ID, [older, newer, tiedLaterId]);
    assert.deepEqual(
      listed.data.map((row) => row.displayName),
      ["Tied high", "Nina", "Ada"],
    );
    assert.deepEqual(
      orderContributionsNewestFirst([older, newer]).map((row) => row.id),
      [newer.id, older.id],
    );
    const json = JSON.stringify(listed);
    assert.equal(json.includes("0xada-wallet"), false);
    assert.equal(json.includes("0xnina-wallet"), false);
    assert.equal(json.includes("funderAddress"), false);
    assert.equal(json.includes("fundTxHash"), false);
    assert.equal(listed.data[1]?.amountUsdc, "2.000000");
    assert.equal(listed.data[1]?.githubLogin, "ada");
  });
});
