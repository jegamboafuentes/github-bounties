import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  FEE_BPS,
  POOL_BPS_OF_POST_FEE,
  POOL_MAX_PAID,
} from "./constants";
import {
  splitFaceAtomic,
  splitFaceUsdc,
  splitPostFeePool,
  splitPostFeePoolAtomic,
  usdcToAtomic,
} from "./money";

type Vector = {
  face: string;
  eligibleCount: number;
  fee: string;
  winner: string;
  poolTotal: string;
  each: string | null;
  dust: string;
};

const vectorsFile = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../fixtures/pool-split-vectors.json",
    ),
    "utf8",
  ),
) as {
  fee_bps: number;
  pool_bps_of_post_fee: number;
  max_paid: number;
  vectors: Vector[];
};

describe("splitPostFeePool (ADR 0003 / V2-0)", () => {
  it("locks fee 200 bps and pool 1500 bps of post-fee, cap 10", () => {
    assert.equal(FEE_BPS, 200);
    assert.equal(POOL_BPS_OF_POST_FEE, 1500);
    assert.equal(POOL_MAX_PAID, 10);
    assert.equal(vectorsFile.fee_bps, 200);
    assert.equal(vectorsFile.pool_bps_of_post_fee, 1500);
    assert.equal(vectorsFile.max_paid, 10);
  });

  it("keeps fee_atomic = floor(F × 200 / 10_000) identical to V1 splitFaceAtomic", () => {
    for (const row of vectorsFile.vectors) {
      const v1 = splitFaceUsdc(row.face);
      const v2 = splitPostFeePool(row.face, row.eligibleCount);
      assert.equal(v2.feeAtomic, v1.feeAtomic, `fee for face=${row.face}`);
      assert.equal(v2.feeUsdc, row.fee);
      assert.equal(v2.postFeeAtomic, v1.hunterAtomic);
    }
  });

  for (const row of vectorsFile.vectors) {
    it(`math vector face=${row.face} |E|=${row.eligibleCount}`, () => {
      const split = splitPostFeePool(row.face, row.eligibleCount);
      assert.equal(split.feeUsdc, row.fee);
      assert.equal(split.winnerUsdc, row.winner);
      assert.equal(split.poolTotalUsdc, row.poolTotal);
      assert.equal(split.eachUsdc, row.each);
      assert.equal(split.dustUsdc, row.dust);

      if (row.eligibleCount === 0) {
        assert.equal(split.poolAtomic, 0n);
        assert.equal(split.winnerAtomic, split.postFeeAtomic);
        assert.equal(split.paidCount, 0);
      } else {
        const expectedPool =
          (split.postFeeAtomic * BigInt(POOL_BPS_OF_POST_FEE)) / 10_000n;
        assert.equal(split.poolAtomic, expectedPool);
        const n = BigInt(split.paidCount);
        const share = expectedPool / n;
        assert.equal(split.shareAtomic, share);
        assert.equal(split.dustAtomic, expectedPool - share * n);
        assert.equal(split.winnerAtomic, split.postFeeAtomic - share * n);
      }

      assert.equal(
        split.feeAtomic + split.winnerAtomic + split.poolPaidAtomic,
        split.faceAtomic,
        "conservation fee + winner + N×each = face",
      );
    });
  }

  it("|E|=12 still allocates 15% of post-fee and pays N=10 (dust → winner)", () => {
    const ten = splitPostFeePool("100.000000", 10);
    const twelve = splitPostFeePool("100.000000", 12);
    assert.equal(twelve.poolAtomic, ten.poolAtomic);
    assert.equal(twelve.paidCount, 10);
    assert.equal(twelve.eligibleCount, 12);
    assert.equal(twelve.shareAtomic, ten.shareAtomic);
    assert.equal(twelve.winnerUsdc, "83.300000");
    assert.equal(twelve.poolTotalUsdc, "14.700000");
    assert.equal(twelve.eachUsdc, "1.470000");
  });

  it("empty-pool regression: 100 USDC → fee 2 + winner 98, pool 0", () => {
    const split = splitPostFeePool("100.000000", 0);
    assert.equal(split.feeUsdc, "2.000000");
    assert.equal(split.winnerUsdc, "98.000000");
    assert.equal(split.poolAtomic, 0n);
    assert.equal(split.poolPaidAtomic, 0n);
    const v1 = splitFaceUsdc("100.000000");
    assert.equal(split.winnerAtomic, v1.hunterAtomic);
  });

  it("matches PM approx 0.833F / 0.147F at 100 USDC with |E|>0", () => {
    const split = splitPostFeePool("100.000000", 2);
    assert.equal(split.winnerUsdc, "83.300000");
    assert.equal(split.poolTotalUsdc, "14.700000");
    assert.equal(split.feeUsdc, "2.000000");
  });

  it("rejects negative eligibleCount", () => {
    assert.throws(() => splitPostFeePool("1.000000", -1), RangeError);
    assert.throws(() => splitPostFeePoolAtomic(1_000_000n, 1.5), RangeError);
  });

  it("does not change V1 splitFaceAtomic hunter remainder", () => {
    const split = splitFaceAtomic(usdcToAtomic("100.000000"));
    assert.equal(split.feeAtomic, 2_000_000n);
    assert.equal(split.hunterAtomic, 98_000_000n);
  });
});
