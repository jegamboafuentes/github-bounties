import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authModule } from "../modules/auth";
import { bountiesModule } from "../modules/bounties";
import { escrowModule } from "../modules/escrow";
import { webhooksModule } from "../modules/webhooks";
import {
  CLAIM_LOCK_HOURS,
  DEFAULT_CHAIN,
  DEFAULT_CURRENCY,
  FEE_BPS,
  PRODUCT_NAME,
} from "./constants";
import { claimLockExpiresAt, feeFromFaceUsdc } from "./money";

describe("product locks", () => {
  it("is GitHub Bounties with a 2% fee and 72h claim-lock", () => {
    assert.equal(PRODUCT_NAME, "GitHub Bounties");
    assert.equal(FEE_BPS, 200);
    assert.equal(CLAIM_LOCK_HOURS, 72);
    assert.equal(DEFAULT_CURRENCY, "USDC");
    assert.equal(DEFAULT_CHAIN, "base");
    assert.equal(authModule.wired, true);
    assert.equal(authModule.name, "auth");
    assert.equal(webhooksModule.wired, true);
    assert.equal(webhooksModule.name, "webhooks");
    assert.equal(bountiesModule.wired, true);
    assert.equal(bountiesModule.name, "bounties");
    assert.equal(escrowModule.wired, true);
    assert.equal(escrowModule.name, "escrow");
  });

  it("computes floor(face * 2%) like ADR 0001", () => {
    assert.equal(feeFromFaceUsdc("100.000000"), "2.000000");
    assert.equal(feeFromFaceUsdc("1.000000"), "0.020000");
    assert.equal(feeFromFaceUsdc("0.010000"), "0.000200");
  });

  it("expires a claim-lock 72 hours after lock", () => {
    const lockedAt = new Date("2026-09-09T12:00:00.000Z");
    assert.equal(
      claimLockExpiresAt(lockedAt, CLAIM_LOCK_HOURS).toISOString(),
      "2026-09-12T12:00:00.000Z",
    );
  });
});
