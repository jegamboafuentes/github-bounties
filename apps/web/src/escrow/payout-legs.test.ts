import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EscrowError, isEscrowError } from "./errors";
import { coverageDecision, executeCoveredLegs, type CoverageLeg, type PayoutLegReport } from "./payout-legs";

const LEG_A: CoverageLeg = {
  destination: "0x089200000000000000000000000000000000A7F4",
  amount: "1.000000",
  amountAtomic: 1_000_000n,
  kind: "REFUND_OUT",
  txHash: null,
  contributionId: "leg-1",
};
const LEG_B: CoverageLeg = {
  destination: "0x86eb000000000000000000000000000000003098",
  amount: "1.000000",
  amountAtomic: 1_000_000n,
  kind: "REFUND_OUT",
  txHash: null,
  contributionId: "leg-2",
};

function silence(run: () => Promise<void>): Promise<void> {
  const original = console.error;
  console.error = () => {};
  return run().finally(() => {
    console.error = original;
  });
}

describe("payout leg coverage", () => {
  it("refuses a two-payer refund before any transfer when the sum is uncovered", async () => {
    let transfers = 0;
    await silence(async () => {
      await assert.rejects(
        () =>
          executeCoveredLegs({
            bountyId: "b99a9163-4ef8-4f73-b051-e404b569bc17",
            verifiedAtomic: 1_000_000n,
            paidAtomic: 0n,
            railMode: "cdp",
            legs: [LEG_A, LEG_B],
            transfer: async () => {
              transfers += 1;
              return { txHash: "0xsent" };
            },
          }),
        (err: unknown) => {
          assert.equal(isEscrowError(err), true);
          assert.equal((err as EscrowError).code, "insufficient_bounty_funds");
          const details = (err as EscrowError).details ?? {};
          assert.equal(details.verifiedAtomic, "1000000");
          assert.equal(details.paidAtomic, "0");
          assert.equal(details.requiredAtomic, "2000000");
          const legs = details.legs as PayoutLegReport[];
          assert.equal(legs.length, 2);
          assert.equal(legs[0]?.destination, LEG_A.destination);
          assert.equal(legs[1]?.destination, LEG_B.destination);
          assert.equal(legs.every((leg) => leg.status === "pending"), true);
          return true;
        },
      );
    });
    assert.equal(transfers, 0);
  });

  it("resumes a partial refund by skipping the leg that already has a tx hash", async () => {
    const paid = { ...LEG_A, txHash: "0x2140d9a975c31dacb260115481338ef4feb88d96a02a5dbed3f462c5ed104f70" };
    const sent: string[] = [];
    const reports = await executeCoveredLegs({
      bountyId: "b99a9163-4ef8-4f73-b051-e404b569bc17",
      verifiedAtomic: 2_000_000n,
      paidAtomic: 1_000_000n,
      railMode: "cdp",
      legs: [paid, LEG_B],
      transfer: async (leg) => {
        sent.push(leg.destination ?? "");
        return { txHash: "0xremaining" };
      },
    });
    assert.deepEqual(sent, [LEG_B.destination]);
    assert.equal(reports[0]?.status, "paid");
    assert.equal(reports[0]?.txHash, paid.txHash);
    assert.equal(reports[1]?.status, "paid");
    assert.equal(reports[1]?.txHash, "0xremaining");
    assert.equal(reports[1]?.destination, LEG_B.destination);
  });

  it("lists paid, failed, and pending legs when a transfer fails mid-way", async () => {
    const third: CoverageLeg = { ...LEG_B, destination: "0x3333000000000000000000000000000000000003", contributionId: "leg-3" };
    await assert.rejects(
      () =>
        executeCoveredLegs({
          bountyId: "bounty",
          verifiedAtomic: 3_000_000n,
          paidAtomic: 0n,
          railMode: "cdp",
          legs: [LEG_A, LEG_B, third],
          transfer: async (leg) => {
            if (leg.contributionId === "leg-2") throw new Error("facilitator down");
            return { txHash: `0x${leg.contributionId}` };
          },
        }),
      (err: unknown) => {
        assert.equal(isEscrowError(err), true);
        assert.equal((err as EscrowError).code, "rail_failed");
        const legs = ((err as EscrowError).details?.legs ?? []) as PayoutLegReport[];
        assert.deepEqual(
          legs.map((leg) => leg.status),
          ["paid", "failed", "pending"],
        );
        assert.equal(legs[1]?.reason, "facilitator down");
        assert.equal(legs[0]?.txHash, "0xleg-1");
        return true;
      },
    );
  });

  it("coverageDecision is the same refusal the runner throws", () => {
    const original = console.error;
    console.error = () => {};
    try {
      const decision = coverageDecision({
        bountyId: "bounty",
        verifiedAtomic: 1n,
        paidAtomic: 0n,
        railMode: "cdp",
        legs: [LEG_A, LEG_B],
      });
      assert.equal(decision.ok, false);
      if (decision.ok) return;
      assert.equal(decision.error.code, "insufficient_bounty_funds");
    } finally {
      console.error = original;
    }
  });
});
