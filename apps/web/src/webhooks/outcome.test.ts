import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claimSkipReasons,
  hasSuccessfulClaimWrite,
  shouldRetryClaimWrites,
} from "./outcome";

describe("claim write outcome helpers", () => {
  it("treats a claimId as a successful write", () => {
    assert.equal(hasSuccessfulClaimWrite([{ issueNumber: 31, claimId: "c1" }]), true);
    assert.equal(hasSuccessfulClaimWrite([{ issueNumber: 31, skip: "hunter_not_linked" }]), false);
    assert.equal(hasSuccessfulClaimWrite([]), false);
    assert.equal(hasSuccessfulClaimWrite(null), false);
  });

  it("lists unique skip reasons", () => {
    assert.deepEqual(
      claimSkipReasons([
        { issueNumber: 31, skip: "hunter_not_linked" },
        { issueNumber: 32, skip: "no_funded_bounty" },
        { issueNumber: 33, skip: "hunter_not_linked" },
      ]),
      ["hunter_not_linked", "no_funded_bounty"],
    );
  });

  it("retries only eligible deliveries that never wrote a claim", () => {
    assert.equal(
      shouldRetryClaimWrites({
        eligible: true,
        claimResults: [{ issueNumber: 31, skip: "hunter_not_linked" }],
      }),
      true,
    );
    assert.equal(
      shouldRetryClaimWrites({ eligible: true, claimResults: null }),
      true,
    );
    assert.equal(
      shouldRetryClaimWrites({
        eligible: true,
        claimResults: [{ issueNumber: 31, claimId: "c1", status: "eligible" }],
      }),
      false,
    );
    assert.equal(
      shouldRetryClaimWrites({ eligible: false, claimResults: [] }),
      false,
    );
  });
});
