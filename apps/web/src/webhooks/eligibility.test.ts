import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateEligibility } from "./eligibility";
import type { EligibilityInput } from "./types";

type Case = {
  id: string;
  description: string;
  expected: boolean;
  expectedClosedIssueNumbers: number[];
  input: EligibilityInput;
};

const cases = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../fixtures/eligibility-cases.json",
    ),
    "utf8",
  ),
) as Case[];

describe("eligibility predicate (merged PR closes #N)", () => {
  it("loads a non-empty fixture table", () => {
    assert.ok(cases.length >= 16, `expected many fixtures, got ${cases.length}`);
  });

  for (const row of cases) {
    it(`${row.id}: ${row.description} → ${row.expected}`, () => {
      const decision = evaluateEligibility(row.input);
      assert.equal(
        decision.eligible,
        row.expected,
        `${row.id} reason=${decision.reason}`,
      );
      assert.deepEqual(decision.closedIssueNumbers, row.expectedClosedIssueNumbers);
      if (decision.eligible) {
        assert.equal(decision.winnerLogin, row.input.pullRequest?.authorLogin);
        assert.equal(decision.pullRequestNumber, row.input.pullRequest?.number);
      }
    });
  }
});
