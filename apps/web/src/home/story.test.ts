import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FEE_BPS, POOL_BPS_OF_POST_FEE, POOL_MAX_PAID } from "../lib/constants";
import { STORY_HEADING, STORY_LEDE, STORY_STEP_IDS, STORY_STEPS } from "./story";

describe("homepage story", () => {
  it("replaces modules with the six product steps in order", () => {
    assert.equal(STORY_HEADING, "How a bounty moves");
    assert.match(STORY_LEDE, /does not change the fee/i);
    assert.deepEqual(
      STORY_STEPS.map((step) => step.id),
      [...STORY_STEP_IDS],
    );
    assert.deepEqual(
      STORY_STEPS.map((step) => step.title),
      [
        "Paste a GitHub issue",
        "Secure USDC escrow",
        "AI bounty intelligence",
        "Fair 85/15 hunter split",
        "Merge / Claim",
        "Global Base settlement",
      ],
    );
    assert.equal(STORY_STEPS[3]?.detail, "Post-fee winner / pool");
  });

  it("describes shipped escrow, split, and claim behavior only", () => {
    const blob = STORY_STEPS.map((step) => `${step.title} ${step.detail ?? ""} ${step.body}`).join(
      "\n",
    );
    assert.match(blob, /GitHub issue URL/);
    assert.match(blob, /gb-escrow/);
    assert.match(blob, /x402 exact/);
    assert.match(blob, new RegExp(`${FEE_BPS / 100}% fee is taken at settlement`));
    assert.match(blob, /not at fund/);
    assert.match(blob, /Hosted checkout is disabled/);
    assert.match(blob, /S, M, or L/);
    assert.match(blob, /not a price/);
    assert.match(blob, new RegExp(`${100 - POOL_BPS_OF_POST_FEE / 100}% of post-fee`));
    assert.match(blob, new RegExp(`${POOL_BPS_OF_POST_FEE / 100}% of post-fee`));
    assert.match(blob, new RegExp(`up to ${POOL_MAX_PAID}`));
    assert.match(blob, /100% of post-fee/);
    assert.match(blob, /98% of face/);
    assert.match(blob, /not a public fundraise/);
    assert.match(blob, /merged pull request/);
    assert.match(blob, /bring-your-own Base address/);
    assert.match(blob, /Working on this does not pay/);
    assert.match(blob, /Base Sepolia/);
    assert.match(blob, /not Lightning/i);
    assert.doesNotMatch(blob, /crowdfund/i);
    assert.doesNotMatch(blob, /kickstarter/i);
    assert.doesNotMatch(blob, /pledge/i);
    assert.doesNotMatch(blob, /token sale/i);
  });
});
