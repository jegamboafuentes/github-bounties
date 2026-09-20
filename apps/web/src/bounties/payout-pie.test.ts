import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitPostFeePool, usdcToAtomic } from "../lib/money";
import {
  describePayoutPie,
  pieSliceArcs,
  payoutPiesFromBreakdown,
  payoutPiesFromFace,
} from "./payout-pie";
import { payoutShareLabels, toPoolRosterView } from "./roster";
import { poolParticipants } from "../db/schema";

type Participant = typeof poolParticipants.$inferSelect;

const NOW = new Date("2026-09-17T12:00:00.000Z");
const BOUNTY = "00000000-0000-4000-8000-000000000071";

function participant(
  partial: Partial<Participant> & Pick<Participant, "id" | "githubLogin" | "role">,
): Participant {
  return {
    bountyId: BOUNTY,
    githubId: 3n,
    userId: "00000000-0000-4000-8000-000000000003",
    qualifyingPrNumber: 10,
    qualifyingPrCreatedAt: new Date("2026-09-17T10:00:00.000Z"),
    qualifyingPrUrl: "https://github.com/octo/hello/pull/10",
    commitSha: "aa",
    frozenAt: NOW,
    shareUsdc: "0",
    payoutAddress: null,
    payoutTxHash: null,
    paidAt: null,
    skipReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function byKey<T extends { key: string }>(rows: T[], key: string): T {
  const row = rows.find((item) => item.key === key);
  assert.ok(row, `missing slice ${key}`);
  return row;
}

describe("payout pie slices (ADR 0003 amounts)", () => {
  it("face 100 |E|=2 slices match breakdown 2 / 83.30 / 14.70", () => {
    const pies = payoutPiesFromFace("100.000000", 2);
    const fee = byKey(pies.face.slices, "fee");
    const winner = byKey(pies.face.slices, "winner");
    const pool = byKey(pies.face.slices, "pool");

    assert.equal(fee.amountUsdc, "2.000000");
    assert.equal(winner.amountUsdc, "83.300000");
    assert.equal(pool.amountUsdc, "14.700000");
    assert.equal(fee.share, 0.02);
    assert.equal(winner.share, 0.833);
    assert.equal(pool.share, 0.147);
    assert.equal(fee.atomic + winner.atomic + pool.atomic, usdcToAtomic("100.000000"));

    const postWinner = byKey(pies.postFee.slices, "winner");
    const postPool = byKey(pies.postFee.slices, "pool");
    assert.equal(pies.postFee.slices.some((slice) => slice.key === "fee"), false);
    assert.equal(postWinner.amountUsdc, "83.300000");
    assert.equal(postPool.amountUsdc, "14.700000");
    assert.equal(postWinner.share, 83.300000 / 98);
    assert.equal(postPool.share, 14.700000 / 98);
    assert.equal(postWinner.atomic + postPool.atomic, usdcToAtomic("98.000000"));
  });

  it("empty-pool face 100 is fee 2% + winner 100% of post-fee (no pool slice)", () => {
    const pies = payoutPiesFromFace("100.000000", 0);
    assert.equal(pies.face.slices.map((slice) => slice.key).join(","), "fee,winner");
    assert.equal(byKey(pies.face.slices, "fee").share, 0.02);
    assert.equal(byKey(pies.face.slices, "winner").amountUsdc, "98.000000");
    assert.equal(byKey(pies.face.slices, "winner").share, 0.98);
    assert.equal(pies.face.slices.some((slice) => slice.key === "pool"), false);

    assert.equal(pies.postFee.slices.length, 1);
    assert.equal(pies.postFee.slices[0]?.key, "winner");
    assert.equal(pies.postFee.slices[0]?.share, 1);
    assert.equal(pies.postFee.slices[0]?.amountUsdc, "98.000000");
    assert.match(pies.postFee.slices[0]?.label ?? "", /100% of post-fee/);
  });

  it("multi-pool |E|=2 and |E|=10 share the same face / post-fee proportions at 100", () => {
    const two = payoutPiesFromFace("100.000000", 2);
    const ten = payoutPiesFromFace("100.000000", 10);
    assert.equal(byKey(two.face.slices, "pool").amountUsdc, "14.700000");
    assert.equal(byKey(ten.face.slices, "pool").amountUsdc, "14.700000");
    assert.equal(byKey(two.face.slices, "winner").amountUsdc, byKey(ten.face.slices, "winner").amountUsdc);
    assert.equal(byKey(two.postFee.slices, "pool").share, byKey(ten.postFee.slices, "pool").share);
  });

  it("mirrors roster breakdown fields — no second split", () => {
    const split = splitPostFeePool("100.000000", 2);
    const view = toPoolRosterView({
      faceUsdc: "100.000000",
      participants: [
        participant({
          id: "00000000-0000-4000-8000-000000000201",
          githubLogin: "octocat",
          role: "winner",
          shareUsdc: split.winnerUsdc,
        }),
        participant({
          id: "00000000-0000-4000-8000-000000000202",
          githubLogin: "alice",
          role: "pool",
          shareUsdc: split.eachUsdc ?? "0",
        }),
        participant({
          id: "00000000-0000-4000-8000-000000000203",
          githubLogin: "bob",
          githubId: 4n,
          role: "pool",
          qualifyingPrNumber: 11,
          shareUsdc: split.eachUsdc ?? "0",
        }),
      ],
    });
    const pies = payoutPiesFromBreakdown(view.breakdown);
    assert.equal(byKey(pies.face.slices, "fee").amountUsdc, view.breakdown.feeUsdc);
    assert.equal(byKey(pies.face.slices, "winner").amountUsdc, view.breakdown.winnerUsdc);
    assert.equal(byKey(pies.face.slices, "pool").amountUsdc, view.breakdown.poolTotalUsdc);
    assert.equal(view.breakdown.winnerShareLabel, "≈83.3%");
    assert.match(byKey(pies.face.slices, "winner").label, /≈83\.3%/);
  });

  it("SVG arcs for face 100 |E|=2 are 7.2° / 299.88° / 52.92° and close at 360", () => {
    const pies = payoutPiesFromFace("100.000000", 2);
    const arcs = pieSliceArcs(pies.face);
    assert.equal(byKey(arcs, "fee").sweepDeg, 7.2);
    assert.equal(byKey(arcs, "winner").sweepDeg, 299.88);
    assert.equal(byKey(arcs, "pool").sweepDeg, 52.92);
    assert.equal(arcs[0]?.startDeg, 0);
    assert.equal(arcs[arcs.length - 1]?.endDeg, 360);
    assert.equal(
      arcs.reduce((sum, arc) => sum + arc.sweepDeg, 0),
      360,
    );
  });

  it("empty-pool post-fee arc is a full circle", () => {
    const pies = payoutPiesFromFace("100.000000", 0);
    const arcs = pieSliceArcs(pies.postFee);
    assert.equal(arcs.length, 1);
    assert.equal(arcs[0]?.key, "winner");
    assert.equal(arcs[0]?.startDeg, 0);
    assert.equal(arcs[0]?.endDeg, 360);
    assert.equal(arcs[0]?.sweepDeg, 360);
  });

  it("describes pies with breakdown labels for the accessible title", () => {
    const pies = payoutPiesFromFace("100.000000", 2);
    assert.match(describePayoutPie(pies.face), /Of face/);
    assert.match(describePayoutPie(pies.face), /Fee \(2%\) 2\.000000 USDC/);
    assert.match(describePayoutPie(pies.face), /Winner \(≈83\.3%\) 83\.300000 USDC/);
    assert.match(describePayoutPie(pies.postFee), /Of post-fee/);
    const labels = payoutShareLabels(splitPostFeePool("100.000000", 0));
    assert.equal(labels.winnerShareLabel, "100% of post-fee");
  });
});
