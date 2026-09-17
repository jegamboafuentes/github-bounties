import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLAIM_SKIP } from "../webhooks/outcome";
import { splitPostFeePool } from "./money";
import {
  frozenParticipantsFromEligibility,
  ownCommitShaAtFreeze,
} from "./pool-freeze-rows";
import {
  loadPoolEligibilityFixtures,
  poolEligibilityInputForCase,
} from "./pool-eligibility-fixtures";
import { evaluatePoolEligibility } from "./pool-eligibility";
import { frozenSetConservesFace } from "./pool-invariants";

const FACE = "100.000000";
const fixtures = loadPoolEligibilityFixtures();

function loginsForRole(
  rows: Array<{ role: string; githubLogin: string }>,
  role: string,
): string[] {
  return rows.filter((row) => row.role === role).map((row) => row.githubLogin);
}

describe("frozenParticipantsFromEligibility (V2-2 / ADR 0003)", () => {
  it("covers every ticket fixture id", () => {
    assert.equal(fixtures.ticketIds.length, 20);
    assert.deepEqual(
      fixtures.cases.map((c) => c.id),
      fixtures.ticketIds,
    );
  });

  for (const row of fixtures.cases) {
    it(`${row.id}: freeze rows match evaluatePoolEligibility`, () => {
      const input = poolEligibilityInputForCase(row);
      const result = evaluatePoolEligibility(input);
      const frozen = frozenParticipantsFromEligibility(input, FACE, result);
      const poolLogins = loginsForRole(frozen.rows, "pool");
      const overflowLogins = loginsForRole(frozen.rows, "overflow");

      assert.deepEqual(poolLogins, row.expectedInE, `${row.id} pool roles`);
      assert.deepEqual(overflowLogins, row.expectedOverflow, `${row.id} overflow`);
      assert.equal(frozen.paidCount, row.expectedInE.length);
      assert.equal(frozen.eligibleCount, result.eligibleCount);

      for (const member of frozen.rows.filter((r) => r.role === "pool")) {
        assert.equal(member.shareUsdc, frozen.eachUsdc);
        assert.notEqual(member.shareUsdc, "0");
      }
      for (const member of frozen.rows.filter((r) => r.role !== "pool" && r.role !== "winner")) {
        assert.equal(member.shareUsdc, "0");
      }

      if (row.id === "not-funded") {
        assert.equal(frozen.rows.length, 0);
        assert.ok(frozen.skipped.every((s) => s.reason === "not_funded"));
        return;
      }

      const winner = frozen.rows.find((r) => r.role === "winner");
      assert.ok(winner, `${row.id} persists winner`);
      assert.equal(winner?.githubLogin, fixtures.meta.winner.login);
      assert.equal(winner?.qualifyingPrNumber, fixtures.meta.winningPr.number);
      assert.equal(winner?.skipReason, CLAIM_SKIP.hunterNotLinked);

      frozenSetConservesFace(
        FACE,
        frozen.rows.map((r) => ({ role: r.role, shareUsdc: r.shareUsdc })),
      );
    });
  }

  it("qualifying-basic: alice is pool; winner persisted, not paid from pool", () => {
    const input = poolEligibilityInputForCase(
      fixtures.cases.find((c) => c.id === "qualifying-basic")!,
    );
    const frozen = frozenParticipantsFromEligibility(input, FACE);
    assert.deepEqual(loginsForRole(frozen.rows, "pool"), ["alice"]);
    assert.equal(frozen.rows.find((r) => r.githubLogin === "winner")?.role, "winner");
    assert.equal(frozen.rows.find((r) => r.githubLogin === "alice")?.role, "pool");
    const split = splitPostFeePool(FACE, 1);
    assert.equal(frozen.rows.find((r) => r.role === "winner")?.shareUsdc, split.winnerUsdc);
    assert.equal(frozen.rows.find((r) => r.role === "pool")?.shareUsdc, split.eachUsdc);
  });

  it("qualifying-draft / fork / closed-unmerged / title-hash stay pool", () => {
    for (const id of [
      "qualifying-draft",
      "qualifying-fork",
      "qualifying-closed-unmerged",
      "qualifying-title-hash",
    ]) {
      const frozen = frozenParticipantsFromEligibility(
        poolEligibilityInputForCase(fixtures.cases.find((c) => c.id === id)!),
        FACE,
      );
      assert.equal(frozen.rows.filter((r) => r.role === "pool").length, 1, id);
    }
  });

  it("late-pr is skipped, not pool", () => {
    const frozen = frozenParticipantsFromEligibility(
      poolEligibilityInputForCase(fixtures.cases.find((c) => c.id === "late-pr")!),
      FACE,
    );
    assert.equal(frozen.rows.some((r) => r.githubLogin === "erin" && r.role === "pool"), false);
    assert.ok(frozen.skipped.some((s) => s.login === "erin" && s.reason === "late_pr"));
  });

  it("no-own-commit and force-push-lost-commits are skipped, not pool", () => {
    for (const id of ["no-own-commit", "force-push-lost-commits"]) {
      const frozen = frozenParticipantsFromEligibility(
        poolEligibilityInputForCase(fixtures.cases.find((c) => c.id === id)!),
        FACE,
      );
      assert.equal(frozen.rows.filter((r) => r.role === "pool").length, 0, id);
      assert.ok(
        frozen.skipped.some((s) => s.reason === "no_own_commit"),
        id,
      );
    }
  });

  it("force-push-after-freeze keeps the freeze snapshot (gina in E)", () => {
    const input = poolEligibilityInputForCase(
      fixtures.cases.find((c) => c.id === "force-push-after-freeze")!,
    );
    const frozen = frozenParticipantsFromEligibility(input, FACE);
    assert.deepEqual(loginsForRole(frozen.rows, "pool"), ["gina"]);
  });

  it("cross-repo other/repo#N is skipped, not pool", () => {
    const frozen = frozenParticipantsFromEligibility(
      poolEligibilityInputForCase(fixtures.cases.find((c) => c.id === "cross-repo")!),
      FACE,
    );
    assert.equal(frozen.rows.some((r) => r.githubLogin === "hank" && r.role === "pool"), false);
    assert.ok(frozen.skipped.some((s) => s.login === "hank" && s.reason === "cross_repo"));
  });

  it("poster and bot persist as excluded_* with share 0", () => {
    const poster = frozenParticipantsFromEligibility(
      poolEligibilityInputForCase(fixtures.cases.find((c) => c.id === "poster-excluded")!),
      FACE,
    );
    const posterRow = poster.rows.find((r) => r.role === "excluded_poster");
    assert.equal(posterRow?.githubLogin, "poster");
    assert.equal(posterRow?.shareUsdc, "0");
    assert.equal(posterRow?.skipReason, "poster");

    const bot = frozenParticipantsFromEligibility(
      poolEligibilityInputForCase(fixtures.cases.find((c) => c.id === "bot-excluded")!),
      FACE,
    );
    const botRow = bot.rows.find((r) => r.role === "excluded_bot");
    assert.equal(botRow?.githubLogin, "dependabot[bot]");
    assert.equal(botRow?.shareUsdc, "0");
    assert.equal(botRow?.skipReason, "bot");
  });

  it("winner earlier PR does not mint a pool share", () => {
    const frozen = frozenParticipantsFromEligibility(
      poolEligibilityInputForCase(fixtures.cases.find((c) => c.id === "winner-excluded")!),
      FACE,
    );
    assert.equal(frozen.rows.filter((r) => r.githubLogin === "winner").length, 1);
    assert.equal(frozen.rows.find((r) => r.githubLogin === "winner")?.role, "winner");
    assert.equal(frozen.rows.filter((r) => r.role === "pool").length, 0);
  });

  it("coauthor-on-winner-only does not put ivy in E", () => {
    const frozen = frozenParticipantsFromEligibility(
      poolEligibilityInputForCase(
        fixtures.cases.find((c) => c.id === "coauthor-on-winner-only")!,
      ),
      FACE,
    );
    assert.equal(frozen.rows.some((r) => r.githubLogin === "ivy"), false);
    assert.equal(frozen.rows.filter((r) => r.role === "pool").length, 0);
  });

  it("|E|>10: first 10 pool, rest overflow share 0", () => {
    const frozen = frozenParticipantsFromEligibility(
      poolEligibilityInputForCase(fixtures.cases.find((c) => c.id === "cap-11th")!),
      FACE,
    );
    assert.equal(frozen.rows.filter((r) => r.role === "pool").length, 10);
    const overflow = frozen.rows.filter((r) => r.role === "overflow");
    assert.deepEqual(
      overflow.map((r) => r.githubLogin),
      ["h11"],
    );
    assert.equal(overflow[0]?.shareUsdc, "0");
    assert.equal(overflow[0]?.skipReason, "overflow");
  });

  it("empty-pool: winner share is 100% of post-fee", () => {
    const frozen = frozenParticipantsFromEligibility(
      poolEligibilityInputForCase(fixtures.cases.find((c) => c.id === "empty-pool")!),
      FACE,
    );
    const split = splitPostFeePool(FACE, 0);
    assert.equal(frozen.rows.length, 1);
    assert.equal(frozen.rows[0]?.role, "winner");
    assert.equal(frozen.rows[0]?.shareUsdc, split.winnerUsdc);
    assert.equal(frozen.rows[0]?.shareUsdc, "98.000000");
  });

  it("linked hunters drop hunter_not_linked; unlinked keep it", () => {
    const input = poolEligibilityInputForCase(
      fixtures.cases.find((c) => c.id === "qualifying-basic")!,
    );
    const linked = frozenParticipantsFromEligibility(
      input,
      FACE,
      evaluatePoolEligibility(input),
      new Set([10]),
    );
    assert.equal(linked.rows.find((r) => r.githubLogin === "alice")?.skipReason, null);
    assert.equal(
      linked.rows.find((r) => r.githubLogin === "winner")?.skipReason,
      CLAIM_SKIP.hunterNotLinked,
    );
  });

  it("ownCommitShaAtFreeze uses the freeze commit list, not later HEAD", () => {
    assert.equal(
      ownCommitShaAtFreeze({
        number: 18,
        title: "x",
        body: "Refs #42",
        authorLogin: "gina",
        authorId: 16,
        createdAt: "2026-09-17T11:00:00.000Z",
        baseRepositoryFullName: "bounty/repo",
        commitAuthorsAtFreeze: [{ login: "gina", githubId: 16 }],
        commitsAtFreeze: [
          { sha: "abc111", authors: [{ login: "gina", githubId: 16 }] },
        ],
      }),
      "abc111",
    );
    assert.equal(
      ownCommitShaAtFreeze({
        number: 17,
        title: "x",
        body: "Refs #42",
        authorLogin: "gina",
        authorId: 16,
        createdAt: "2026-09-17T11:00:00.000Z",
        baseRepositoryFullName: "bounty/repo",
        commitAuthorsAtFreeze: [],
        commitsAtFreeze: [],
      }),
      null,
    );
  });
});
