import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLAIM_SKIP } from "../webhooks/outcome";
import { allocationLedger, poolParticipants } from "../db/schema";
import { overflowNotPaidLabel } from "./display";
import { payoutShareLabels, toPoolRosterView } from "./roster";
import { splitPostFeePool } from "../lib/money";

type Participant = typeof poolParticipants.$inferSelect;
type Leg = typeof allocationLedger.$inferSelect;

const NOW = new Date("2026-09-17T12:00:00.000Z");
const BOUNTY = "00000000-0000-4000-8000-000000000071";

function participant(partial: Partial<Participant> & Pick<Participant, "id" | "githubLogin" | "role">): Participant {
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

function leg(partial: Partial<Leg> & Pick<Leg, "id" | "kind" | "amountUsdc">): Leg {
  return {
    bountyId: BOUNTY,
    participantId: null,
    toAddress: null,
    idempotencyKey: partial.id,
    txHash: null,
    status: "confirmed",
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

describe("pool roster view", () => {
  it("shows winner, equal pool shares, tx hashes, and ≈83.3 / ≈14.7 labels", () => {
    const split = splitPostFeePool("100.000000", 2);
    const labels = payoutShareLabels(split);
    assert.equal(labels.winnerShareLabel, "≈83.3%");
    assert.equal(labels.poolShareLabel, "≈14.7%");

    const winnerId = "00000000-0000-4000-8000-000000000201";
    const aliceId = "00000000-0000-4000-8000-000000000202";
    const bobId = "00000000-0000-4000-8000-000000000203";
    const view = toPoolRosterView({
      faceUsdc: "100.000000",
      participants: [
        participant({
          id: winnerId,
          githubLogin: "octocat",
          githubId: 2n,
          role: "winner",
          qualifyingPrNumber: 100,
          shareUsdc: split.winnerUsdc,
          payoutTxHash: "mock:winner",
        }),
        participant({
          id: aliceId,
          githubLogin: "alice",
          githubId: 3n,
          role: "pool",
          qualifyingPrNumber: 10,
          shareUsdc: split.eachUsdc ?? "0",
        }),
        participant({
          id: bobId,
          githubLogin: "bob",
          githubId: 4n,
          role: "pool",
          qualifyingPrNumber: 11,
          qualifyingPrCreatedAt: new Date("2026-09-17T11:00:00.000Z"),
          shareUsdc: split.eachUsdc ?? "0",
        }),
      ],
      legs: [
        leg({
          id: "00000000-0000-4000-8000-000000000301",
          kind: "FEE_OUT",
          amountUsdc: split.feeUsdc,
          txHash: "mock:fee",
        }),
        leg({
          id: "00000000-0000-4000-8000-000000000302",
          kind: "WINNER_PAYOUT",
          amountUsdc: split.winnerUsdc,
          participantId: winnerId,
          txHash: "mock:winner",
        }),
        leg({
          id: "00000000-0000-4000-8000-000000000303",
          kind: "POOL_PAYOUT",
          amountUsdc: split.eachUsdc ?? "0",
          participantId: aliceId,
          txHash: "mock:alice",
        }),
        leg({
          id: "00000000-0000-4000-8000-000000000304",
          kind: "POOL_PAYOUT",
          amountUsdc: split.eachUsdc ?? "0",
          participantId: bobId,
          txHash: "mock:bob",
        }),
      ],
    });

    assert.equal(view.frozen, true);
    assert.equal(view.winner?.githubLogin, "octocat");
    assert.equal(view.pool.length, 2);
    assert.equal(view.pool[0]?.githubLogin, "alice");
    assert.equal(view.pool[0]?.qualifyingPrNumber, 10);
    assert.equal(view.pool[0]?.shareUsdc, "7.350000");
    assert.equal(view.pool[0]?.payoutTxHash, "mock:alice");
    assert.equal(view.pool[0]?.paid, true);
    assert.equal(view.pool[1]?.paid, true);
    assert.equal(view.winner?.paid, true);
    assert.equal(view.breakdown.feeUsdc, "2.000000");
    assert.equal(view.breakdown.winnerUsdc, "83.300000");
    assert.equal(view.breakdown.poolTotalUsdc, "14.700000");
    assert.equal(view.breakdown.eachUsdc, "7.350000");
    assert.equal(view.breakdown.feeTxHash, "mock:fee");
    assert.equal(view.breakdown.winnerTxHash, "mock:winner");
    assert.equal(view.overflowCaption, null);
  });

  it("uses 100% of post-fee when E is empty", () => {
    const view = toPoolRosterView({
      faceUsdc: "100.000000",
      participants: [
        participant({
          id: "00000000-0000-4000-8000-000000000211",
          githubLogin: "octocat",
          role: "winner",
          shareUsdc: "98.000000",
        }),
      ],
    });
    assert.equal(view.breakdown.emptyPool, true);
    assert.equal(view.breakdown.winnerUsdc, "98.000000");
    assert.equal(view.breakdown.winnerShareLabel, "100% of post-fee");
    assert.equal(view.breakdown.poolShareLabel, "0");
    assert.equal(view.pool.length, 0);
  });

  it("captions overflow +K not paid, cap 10 and shows excluded poster", () => {
    const overflow = participant({
      id: "00000000-0000-4000-8000-000000000221",
      githubLogin: "hunter11",
      githubId: 11n,
      role: "overflow",
      shareUsdc: "0",
      skipReason: "overflow",
    });
    const poster = participant({
      id: "00000000-0000-4000-8000-000000000222",
      githubLogin: "ada-maintainer",
      githubId: 1n,
      role: "excluded_poster",
      qualifyingPrNumber: 8,
      shareUsdc: "0",
      skipReason: "poster",
    });
    const view = toPoolRosterView({
      faceUsdc: "100.000000",
      participants: [
        participant({
          id: "00000000-0000-4000-8000-000000000223",
          githubLogin: "alice",
          role: "pool",
          shareUsdc: "1.470000",
        }),
        overflow,
        poster,
      ],
    });
    assert.equal(view.overflowCount, 1);
    assert.equal(view.overflowCaption, overflowNotPaidLabel(1));
    assert.equal(view.overflowCaption, "+1 not paid, cap 10");
    assert.equal(view.excludedPoster?.githubLogin, "ada-maintainer");
    assert.equal(view.excludedPoster?.qualifyingPrNumber, 8);
  });

  it("marks unlinked members and pre-merge candidates with freeze copy", () => {
    const unlinked = toPoolRosterView({
      faceUsdc: "100.000000",
      participants: [
        participant({
          id: "00000000-0000-4000-8000-000000000231",
          githubLogin: "unlinked-hunter",
          githubId: 999001n,
          userId: null,
          role: "pool",
          skipReason: CLAIM_SKIP.hunterNotLinked,
          shareUsdc: "14.700000",
        }),
      ],
    });
    assert.equal(unlinked.pool[0]?.unlinked, true);

    const live = toPoolRosterView({
      faceUsdc: "100.000000",
      participants: [
        participant({
          id: "00000000-0000-4000-8000-000000000232",
          githubLogin: "cara",
          role: "pool",
          frozenAt: null,
          shareUsdc: "0",
        }),
      ],
    });
    assert.equal(live.frozen, false);
    assert.equal(live.candidates.length, 1);
    assert.equal(live.candidates[0]?.githubLogin, "cara");
    assert.match(live.eligibilityFreezeCopy, /freezes at the winning merge/i);
  });
});
