import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { POOL_BPS_OF_POST_FEE, POOL_MAX_PAID } from "./constants";
import { splitPostFeePool } from "./money";
import { frozenSetConservesFace, ledgerConservesFace } from "./pool-invariants";

const FACE = "100.000000";

describe("V2-1 frozen set / ledger invariants", () => {
  it("documents participation_pool_bps = 1500 of post-fee", () => {
    assert.equal(POOL_BPS_OF_POST_FEE, 1500);
    const withPool = splitPostFeePool(FACE, 2);
    assert.equal(withPool.poolBpsOfPostFee, 1500);
    assert.equal(withPool.feeUsdc, "2.000000");
    assert.equal(withPool.winnerUsdc, "83.300000");
    assert.equal(withPool.poolTotalUsdc, "14.700000");
  });

  it("|E|=2: fee + winner + Σ pool shares = F", () => {
    const split = splitPostFeePool(FACE, 2);
    const result = frozenSetConservesFace(FACE, [
      { role: "winner", shareUsdc: split.winnerUsdc },
      { role: "pool", shareUsdc: split.eachUsdc ?? "0" },
      { role: "pool", shareUsdc: split.eachUsdc ?? "0" },
    ]);
    assert.equal(result.eligibleCount, 2);
    assert.equal(result.sumAtomic, result.faceAtomic);
    ledgerConservesFace(FACE, [
      { kind: "FEE_OUT", amountUsdc: split.feeUsdc },
      { kind: "WINNER_PAYOUT", amountUsdc: split.winnerUsdc },
      { kind: "POOL_PAYOUT", amountUsdc: split.eachUsdc ?? "0" },
      { kind: "POOL_PAYOUT", amountUsdc: split.eachUsdc ?? "0" },
    ]);
  });

  it("|E|=0 empty-pool regression: fee + winner = F, no pool shares", () => {
    const split = splitPostFeePool(FACE, 0);
    const result = frozenSetConservesFace(FACE, [
      { role: "winner", shareUsdc: split.winnerUsdc },
    ]);
    assert.equal(result.eligibleCount, 0);
    assert.equal(split.winnerUsdc, "98.000000");
    assert.equal(result.poolShares.length, 0);
    ledgerConservesFace(FACE, [
      { kind: "FEE_OUT", amountUsdc: split.feeUsdc },
      { kind: "WINNER_PAYOUT", amountUsdc: split.winnerUsdc },
    ]);
    assert.throws(
      () =>
        ledgerConservesFace(FACE, [
          { kind: "FEE_OUT", amountUsdc: split.feeUsdc },
          { kind: "WINNER_PAYOUT", amountUsdc: split.winnerUsdc },
          { kind: "POOL_PAYOUT", amountUsdc: "0.000001" },
        ]),
      /ledger sum != face|WINNER_PAYOUT/,
    );
  });

  it("11th overflow: share 0, Σ of 10 paid pool shares still conserves F", () => {
    const split = splitPostFeePool(FACE, POOL_MAX_PAID + 1);
    assert.equal(split.paidCount, 10);
    const pool = Array.from({ length: 10 }, () => ({
      role: "pool",
      shareUsdc: split.eachUsdc ?? "0",
    }));
    const result = frozenSetConservesFace(FACE, [
      { role: "winner", shareUsdc: split.winnerUsdc },
      ...pool,
      { role: "overflow", shareUsdc: "0" },
    ]);
    assert.equal(result.eligibleCount, 11);
    assert.equal(result.sumAtomic, result.faceAtomic);
  });

  it("poster / bot excluded rows are zero-share and ignored in E", () => {
    const split = splitPostFeePool(FACE, 1);
    frozenSetConservesFace(FACE, [
      { role: "winner", shareUsdc: split.winnerUsdc },
      { role: "pool", shareUsdc: split.eachUsdc ?? "0" },
      { role: "excluded_poster", shareUsdc: "0" },
      { role: "excluded_bot", shareUsdc: "0" },
    ]);
    assert.throws(
      () =>
        frozenSetConservesFace(FACE, [
          { role: "winner", shareUsdc: split.winnerUsdc },
          { role: "excluded_poster", shareUsdc: "1.000000" },
        ]),
      /excluded_poster share_usdc must be 0/,
    );
  });
});
