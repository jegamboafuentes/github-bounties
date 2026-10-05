import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateHuggingFaceMerge, HF_MERGE_SKIP, type HfMergeFacts } from "./merge-rules";

const bountyCreated = new Date("2026-10-01T00:00:00.000Z");
const prCreated = new Date("2026-10-02T00:00:00.000Z");

function facts(overrides: Partial<HfMergeFacts> = {}): HfMergeFacts {
  return {
    isPullRequest: true,
    status: "merged",
    mergeCommitId: "abc123",
    baseRef: "refs/heads/main",
    defaultBranch: "main",
    createdAt: prCreated,
    bountyCreatedAt: bountyCreated,
    author: { login: "ada", id: "hf-ada" },
    authorIsOrgMember: false,
    orgMember: false,
    merger: { login: "owner", id: "hf-owner", isOwner: true, isOrgMember: false },
    repoOwner: "acme",
    blocked: [],
    ...overrides,
  };
}

describe("Hugging Face merge rules", () => {
  it("accepts a real merge by an owner onto the default branch", () => {
    assert.deepEqual(evaluateHuggingFaceMerge(facts()), { kind: "eligible" });
    assert.deepEqual(evaluateHuggingFaceMerge(facts({ baseRef: "main" })), { kind: "eligible" });
  });

  function skip(overrides: Partial<HfMergeFacts>): string | undefined {
    const decision = evaluateHuggingFaceMerge(facts(overrides));
    return decision.kind === "eligible" ? undefined : decision.skip;
  }

  it("refuses a pull request that is not a merged commit on the default branch", () => {
    assert.equal(skip({ isPullRequest: false }), HF_MERGE_SKIP.notAPullRequest);
    assert.equal(skip({ status: "open" }), HF_MERGE_SKIP.notMerged);
    assert.equal(skip({ mergeCommitId: null }), HF_MERGE_SKIP.missingMergeCommit);
    assert.equal(skip({ baseRef: "refs/heads/dev" }), HF_MERGE_SKIP.wrongBase);
    assert.equal(skip({ createdAt: bountyCreated }), HF_MERGE_SKIP.prBeforeBounty);
    assert.equal(skip({ createdAt: null }), HF_MERGE_SKIP.prBeforeBounty);
    assert.equal(skip({ author: { login: null, id: null } }), HF_MERGE_SKIP.authorMissing);
  });

  it("refuses self-merge and insiders before it flags a weak merger", () => {
    assert.equal(skip({ author: { login: "Acme", id: "x" } }), HF_MERGE_SKIP.selfMerge);
    assert.equal(
      skip({ merger: { login: "Ada", id: "other", isOwner: true, isOrgMember: false } }),
      HF_MERGE_SKIP.selfMerge,
    );
    assert.equal(skip({ blocked: [{ login: "ada", id: "poster" }] }), HF_MERGE_SKIP.selfMerge);
    assert.equal(skip({ authorIsOrgMember: true }), HF_MERGE_SKIP.insider);
    assert.equal(skip({ orgMember: true }), HF_MERGE_SKIP.insider);
    assert.equal(
      skip({ merger: { login: "pat", id: "pat", isOwner: false, isOrgMember: false } }),
      HF_MERGE_SKIP.mergerReviewRequired,
    );
    assert.equal(skip({ merger: null }), HF_MERGE_SKIP.mergerReviewRequired);
  });
});
