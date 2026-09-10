import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HOSTED_CHECKOUT_ENABLED, hostedCheckoutStatus } from "./hosted";
import {
  assertEscrowTransition,
  canTransitionEscrow,
  ESCROW_LOCKED,
  ESCROW_RELEASED,
} from "./state";

describe("escrow state machine", () => {
  it("maps ticket locked/released onto schema funded/settled", () => {
    assert.equal(ESCROW_LOCKED, "funded");
    assert.equal(ESCROW_RELEASED, "settled");
  });

  it("allows pending → funded (lock) → settling → settled (release)", () => {
    assert.equal(canTransitionEscrow("pending", "funded"), true);
    assert.equal(canTransitionEscrow("funded", "settling"), true);
    assert.equal(canTransitionEscrow("settling", "settled"), true);
    assert.equal(canTransitionEscrow("settling", "settled_partial"), true);
    assert.equal(canTransitionEscrow("settled_partial", "settled"), true);
  });

  it("allows funded → refunding → refunded and pending → failed", () => {
    assert.equal(canTransitionEscrow("funded", "refunding"), true);
    assert.equal(canTransitionEscrow("refunding", "refunded"), true);
    assert.equal(canTransitionEscrow("pending", "failed"), true);
  });

  it("forbids silent jumps and terminal rollback", () => {
    assert.equal(canTransitionEscrow("pending", "settled"), false);
    assert.equal(canTransitionEscrow("settled", "funded"), false);
    assert.equal(canTransitionEscrow("refunded", "funded"), false);
    assert.equal(canTransitionEscrow("settled", "refunding"), false);
    assert.throws(() => assertEscrowTransition("pending", "settled"), /illegal escrow transition/);
  });

  it("keeps hosted checkout disabled (ADR open Q)", () => {
    assert.equal(HOSTED_CHECKOUT_ENABLED, false);
    const status = hostedCheckoutStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.blocked, true);
    assert.match(status.reason, /settlement\.feeAmount/);
  });
});
