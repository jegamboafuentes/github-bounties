import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { poolPayoutBreakdown } from "../../bounties/display";
import type { BoardBounty } from "../../bounties/list";
import type { PoolRosterView } from "../../bounties/roster";
import type { BountyContributionView } from "../../escrow/top-up";
import {
  confirmedTotalFor,
  contributionAmountsFromQuery,
  sumConfirmedContributionAmounts,
  ZERO_FUNDED_USDC,
} from "./funded";
import {
  orderContributionsNewestFirst,
  presentBountyDetail,
  presentFunderList,
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
