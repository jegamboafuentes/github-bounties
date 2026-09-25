import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PublicApiError } from "../public/errors";
import { authorizeClaimCaller } from "./claim-auth";
import { claimLegDestination } from "./claim-leg";
import type { ClaimAuthContext } from "./deps";

const bounty: NonNullable<ClaimAuthContext["bounty"]> = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Pool bounty",
  status: "funded",
  amountUsdc: "10.000000",
  posterUserId: "poster",
};

function ctx(rosterFrozen: boolean, pool: ClaimAuthContext["pool"]): ClaimAuthContext {
  return {
    bounty,
    walletAddress: "0x1111111111111111111111111111111111111111",
    githubLogin: "ada",
    winner: null,
    pool,
    rosterFrozen,
  };
}

describe("pool claim auth order", () => {
  it("returns pool_not_ready before not_pool_member when the roster is not frozen", () => {
    assert.throws(
      () => authorizeClaimCaller("user", "pool", ctx(false, null)),
      (err: unknown) => {
        assert.ok(err instanceof PublicApiError);
        assert.equal(err.code, "pool_not_ready");
        assert.equal(err.status, 409);
        return true;
      },
    );
  });

  it("returns not_pool_member once the roster is frozen and the caller has no row", () => {
    assert.throws(
      () => authorizeClaimCaller("user", "pool", ctx(true, null)),
      (err: unknown) => {
        assert.ok(err instanceof PublicApiError);
        assert.equal(err.code, "not_pool_member");
        return true;
      },
    );
  });

  it("uses the paid address, otherwise the saved wallet", () => {
    const paid = "0x1111111111111111111111111111111111111111";
    const saved = "0x2222222222222222222222222222222222222222";
    assert.equal(claimLegDestination(paid, saved), paid);
    assert.equal(claimLegDestination("  ", saved), saved);
    assert.equal(claimLegDestination(null, null), null);
  });
});
