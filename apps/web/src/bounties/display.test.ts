import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bountyStatusLabel,
  claimedByUntilLabel,
  CLAIM_PAYOUT_COPY,
  ELIGIBILITY_FREEZE_COPY,
  formatLockDeadlineUtc,
  formatUsdc,
  hunterLabel,
  isActiveClaimLock,
  LOCK_NOT_MONEY_COPY,
  overflowNotPaidLabel,
  PARALLEL_HUNT_COPY,
  poolPayoutBreakdown,
  POOL_CLAIM_COPY,
  POOL_PAYOUT_COPY,
  sharePaidLabel,
  unlinkedPoolMemberCaption,
  workingOnThisCaption,
  X402_EXACT_FUND_COPY,
  fundLockCopy,
  fundRailCaption,
  x402ExactFundCopy,
  payoutBreakdown,
  payoutCaption,
} from "./display";

describe("board display helpers", () => {
  it("keeps the historical Claimed by X until helper but does not advertise it", () => {
    const expiresAt = new Date("2026-09-12T12:00:00.000Z");
    assert.equal(formatLockDeadlineUtc(expiresAt), "2026-09-12 12:00 UTC");
    assert.equal(
      claimedByUntilLabel({ hunterLabel: "octocat", expiresAt }),
      "Claimed by octocat until 2026-09-12 12:00 UTC",
    );
    assert.doesNotMatch(PARALLEL_HUNT_COPY, /Claimed by/);
    assert.doesNotMatch(LOCK_NOT_MONEY_COPY, /Claimed by/);
  });

  it("prefers GitHub login for the hunter label", () => {
    assert.equal(hunterLabel({ githubLogin: "octocat", displayName: "Hunter Example" }), "octocat");
    assert.equal(hunterLabel({ displayName: "Ada" }), "Ada");
    assert.equal(hunterLabel({}), "someone");
  });

  it("treats only unexpired active rows as leftover locks", () => {
    const now = new Date("2026-09-12T11:00:00.000Z");
    assert.equal(
      isActiveClaimLock(
        { status: "active", expiresAt: new Date("2026-09-12T12:00:00.000Z") },
        now,
      ),
      true,
    );
    assert.equal(
      isActiveClaimLock(
        { status: "active", expiresAt: new Date("2026-09-12T10:00:00.000Z") },
        now,
      ),
      false,
    );
    assert.equal(
      isActiveClaimLock(
        { status: "released", expiresAt: new Date("2026-09-12T12:00:00.000Z") },
        now,
      ),
      false,
    );
  });

  it("documents parallel hunt, freeze copy, and merge is truth", () => {
    assert.match(LOCK_NOT_MONEY_COPY, /does not move money/i);
    assert.match(LOCK_NOT_MONEY_COPY, /merge is still truth/i);
    assert.match(LOCK_NOT_MONEY_COPY, /not exclusive/i);
    assert.match(ELIGIBILITY_FREEZE_COPY, /freezes at the winning merge/i);
    assert.match(POOL_PAYOUT_COPY, /Winner Claim pays winner \+ fee only/i);
    assert.equal(bountyStatusLabel("claim_locked"), "Funded (open)");
    assert.equal(bountyStatusLabel("funded"), "Funded (open)");
    assert.equal(bountyStatusLabel("settled"), "Completed (paid)");
    assert.equal(bountyStatusLabel("settled_partial"), "Winner paid — pool pending");
    assert.match(CLAIM_PAYOUT_COPY, /eligible winner/i);
    assert.match(CLAIM_PAYOUT_COPY, /do not block the winner/i);
    assert.match(X402_EXACT_FUND_COPY, /x402 exact/i);
    assert.match(X402_EXACT_FUND_COPY, /wallet|WalletConnect/i);
    assert.match(X402_EXACT_FUND_COPY, /no explorer hash|no hash paste|Lock does not need a paste/i);
    assert.match(x402ExactFundCopy("Base"), /Connect a Base wallet/);
    assert.doesNotMatch(x402ExactFundCopy("Base"), /Sepolia/);
    assert.match(fundLockCopy("Base"), /on Base when CDP_\*/);
    assert.doesNotMatch(fundLockCopy("Base"), /Sepolia/);
    assert.match(fundRailCaption("Base"), /rail Base \(CDP\)/);
    assert.doesNotMatch(fundRailCaption("Base"), /Sepolia/);
    assert.match(x402ExactFundCopy("Base Sepolia"), /Base Sepolia/);
    assert.match(fundLockCopy("Base Sepolia"), /Base Sepolia/);
  });

  it("formats overflow +K not paid, cap 10 and unlinked CTA", () => {
    assert.equal(overflowNotPaidLabel(1), "+1 not paid, cap 10");
    assert.equal(overflowNotPaidLabel(3, 10), "+3 not paid, cap 10");
    assert.equal(overflowNotPaidLabel(0), "");
    assert.match(unlinkedPoolMemberCaption("unlinked-hunter"), /Connect GitHub/);
    assert.equal(
      workingOnThisCaption([{ hunterLabel: "alice" }, { hunterLabel: "bob" }]),
      "2 hunters working on this: alice, bob",
    );
  });

  it("shows face / 2% fee / net and paid captions", () => {
    const split = payoutBreakdown("100.000000");
    assert.equal(formatUsdc(split.faceUsdc), "100");
    assert.equal(formatUsdc(split.feeUsdc), "2");
    assert.equal(formatUsdc(split.hunterUsdc), "98");
    assert.equal(split.feeBps, 200);
    assert.equal(payoutCaption({ status: "paid", hunterLabel: "octocat" }), "Paid to octocat");
    assert.equal(
      payoutCaption({ status: "eligible", hunterLabel: "octocat" }),
      "Payout eligible — octocat can claim",
    );
    assert.equal(sharePaidLabel(true), "Paid");
    assert.equal(sharePaidLabel(false), "Claim pending");
    assert.match(POOL_CLAIM_COPY, /frozen pool share/i);
  });

  it("splits V2 pool face 100 into winner ≈83.3 and pool ≈14.7", () => {
    const two = poolPayoutBreakdown("100.000000", 2);
    assert.equal(two.feeUsdc, "2.000000");
    assert.equal(two.winnerUsdc, "83.300000");
    assert.equal(two.poolTotalUsdc, "14.700000");
    assert.equal(two.eachUsdc, "7.350000");
    assert.equal(two.emptyPool, false);
    const empty = poolPayoutBreakdown("100.000000", 0);
    assert.equal(empty.winnerUsdc, "98.000000");
    assert.equal(empty.poolTotalUsdc, "0.000000");
    assert.equal(empty.emptyPool, true);
  });
});
