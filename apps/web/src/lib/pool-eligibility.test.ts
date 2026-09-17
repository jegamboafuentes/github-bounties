import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { POOL_MAX_PAID } from "./constants";
import {
  pullRequestReferencesIssue,
  referencedIssueNumbersForRepo,
} from "./issue-refs";
import {
  loadPoolEligibilityFixtures,
  poolEligibilityInputForCase,
  type PoolFixtureHunterSeed,
} from "./pool-eligibility-fixtures";
import {
  capPaidPool,
  comparePoolRank,
  evaluatePoolEligibility,
} from "./pool-eligibility";
import { closingIssueNumbersForRepo } from "../webhooks/closing-keywords";

const fixtures = loadPoolEligibilityFixtures();
const toInput = poolEligibilityInputForCase;

describe("pool eligibility fixtures (ADR 0003 / V2-0)", () => {
  it("covers every row in the ticket Pool eligibility fixtures table", () => {
    assert.equal(fixtures.ticketIds.length, 20);
    const ids = new Set(fixtures.cases.map((c) => c.id));
    for (const id of fixtures.ticketIds) {
      assert.ok(ids.has(id), `missing fixture case ${id}`);
    }
    assert.deepEqual(
      fixtures.cases.map((c) => c.id),
      fixtures.ticketIds,
    );
  });

  for (const row of fixtures.cases) {
    it(`${row.id}: ${row.description}`, () => {
      const result = evaluatePoolEligibility(toInput(row));
      assert.deepEqual(
        result.paid.map((m) => m.login),
        row.expectedInE,
        `${row.id} paid set`,
      );
      assert.deepEqual(
        result.overflow.map((m) => m.login),
        row.expectedOverflow,
        `${row.id} overflow`,
      );
      assert.equal(result.paidCount, row.expectedInE.length);
      assert.ok(result.paidCount <= POOL_MAX_PAID);
      for (const member of result.paid) {
        assert.equal(member.role, "pool");
      }
      for (const member of result.overflow) {
        assert.equal(member.role, "overflow");
      }

      if (row.id === "empty-pool" || row.id === "not-funded") {
        assert.equal(result.eligibleCount, 0);
        assert.equal(result.paid.length, 0);
      }

      if (row.assertNotV1WinnerCloser) {
        const pr = row.pullRequests?.[0];
        assert.ok(pr);
        assert.deepEqual(
          closingIssueNumbersForRepo(
            [pr.title, pr.body, ...(pr.commitMessages ?? [])],
            fixtures.meta.repositoryFullName,
          ),
          [],
          "Refs #42 is not a V1 winner closer",
        );
        assert.equal(
          pullRequestReferencesIssue(
            pr,
            fixtures.meta.bountyIssueNumber,
            fixtures.meta.repositoryFullName,
          ),
          true,
        );
      }
    });
  }

  it("cap: 12 eligible → paid set is the 10 earliest created_at", () => {
    const hunters: PoolFixtureHunterSeed[] = [];
    for (let i = 1; i <= 12; i += 1) {
      const n = String(i).padStart(2, "0");
      hunters.push({
        login: `h${n}`,
        githubId: 100 + i,
        prNumber: i,
        createdAt: `2026-09-16T${String(i).padStart(2, "0")}:00:00.000Z`,
      });
    }
    const result = evaluatePoolEligibility(
      toInput({
        id: "cap-12",
        description: "12 eligible",
        expectedInE: [],
        expectedOverflow: [],
        qualifyingHunters: hunters,
      }),
    );
    assert.equal(result.eligibleCount, 12);
    assert.equal(result.paidCount, 10);
    assert.deepEqual(
      result.paid.map((m) => m.login),
      ["h01", "h02", "h03", "h04", "h05", "h06", "h07", "h08", "h09", "h10"],
    );
    assert.deepEqual(
      result.overflow.map((m) => m.login),
      ["h11", "h12"],
    );
  });

  it("tie-break github_id ASC when created_at and pr_number match", () => {
    const ranked = capPaidPool(
      [
        {
          githubId: 9,
          qualifyingPrNumber: 4,
          qualifyingPrCreatedAt: "2026-09-16T10:00:00.000Z",
        },
        {
          githubId: 3,
          qualifyingPrNumber: 4,
          qualifyingPrCreatedAt: "2026-09-16T10:00:00.000Z",
        },
      ],
      1,
    );
    assert.equal(ranked.paid[0]?.githubId, 3);
    assert.equal(ranked.overflow[0]?.githubId, 9);
    assert.ok(
      comparePoolRank(
        {
          githubId: 3,
          qualifyingPrNumber: 4,
          qualifyingPrCreatedAt: "2026-09-16T10:00:00.000Z",
        },
        {
          githubId: 9,
          qualifyingPrNumber: 4,
          qualifyingPrCreatedAt: "2026-09-16T10:00:00.000Z",
        },
      ) < 0,
    );
  });
});

describe("issue refs (pool references #N)", () => {
  const repo = "bounty/repo";

  it("accepts Refs / Related to / See and title #N", () => {
    assert.deepEqual(referencedIssueNumbersForRepo({ title: "x", body: "Refs #42" }, repo), [
      42,
    ]);
    assert.deepEqual(
      referencedIssueNumbersForRepo({ title: "x", body: "Related to #42" }, repo),
      [42],
    );
    assert.deepEqual(referencedIssueNumbersForRepo({ title: "x", body: "See #42" }, repo), [
      42,
    ]);
    assert.deepEqual(referencedIssueNumbersForRepo({ title: "#42 hunt", body: "" }, repo), [
      42,
    ]);
  });

  it("does not treat Duplicate of #N only as a reference", () => {
    assert.deepEqual(
      referencedIssueNumbersForRepo({ title: "Duplicate of #42", body: "" }, repo),
      [],
    );
    assert.deepEqual(
      referencedIssueNumbersForRepo({ title: "notes", body: "Duplicate of #42" }, repo),
      [],
    );
  });

  it("ignores cross-repo owner/other#N", () => {
    assert.deepEqual(
      referencedIssueNumbersForRepo({ title: "x", body: "Fixes other/repo#42" }, repo),
      [],
    );
    assert.deepEqual(
      referencedIssueNumbersForRepo({ title: "x", body: "Fixes bounty/repo#42" }, repo),
      [42],
    );
  });
});
