import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bountyStatusLabel,
  claimedByUntilLabel,
  formatLockDeadlineUtc,
  hunterLabel,
  isActiveClaimLock,
  LOCK_NOT_MONEY_COPY,
} from "./display";

describe("board display helpers", () => {
  it("formats Claimed by X until … in UTC", () => {
    const expiresAt = new Date("2026-09-12T12:00:00.000Z");
    assert.equal(formatLockDeadlineUtc(expiresAt), "2026-09-12 12:00 UTC");
    assert.equal(
      claimedByUntilLabel({ hunterLabel: "octocat", expiresAt }),
      "Claimed by octocat until 2026-09-12 12:00 UTC",
    );
  });

  it("prefers GitHub login for the hunter label", () => {
    assert.equal(hunterLabel({ githubLogin: "octocat", displayName: "Hunter Example" }), "octocat");
    assert.equal(hunterLabel({ displayName: "Ada" }), "Ada");
    assert.equal(hunterLabel({}), "someone");
  });

  it("treats only unexpired active rows as locks", () => {
    const now = new Date("2026-09-12T11:00:00.000Z");
    assert.equal(
      isActiveClaimLock(
        { status: "active", expiresAt: new Date("2026-09-12T12:00:00.000Z") },
        now,
      ),
      true,
    );
    assert.equal(
      isActiveClaimLock(
        { status: "active", expiresAt: new Date("2026-09-12T10:00:00.000Z") },
        now,
      ),
      false,
    );
    assert.equal(
      isActiveClaimLock(
        { status: "released", expiresAt: new Date("2026-09-12T12:00:00.000Z") },
        now,
      ),
      false,
    );
  });

  it("documents lock ≠ money and merge is truth", () => {
    assert.match(LOCK_NOT_MONEY_COPY, /does not move money/i);
    assert.match(LOCK_NOT_MONEY_COPY, /merge is still truth/i);
    assert.equal(bountyStatusLabel("claim_locked"), "Claim-locked");
    assert.equal(bountyStatusLabel("funded"), "Funded (open)");
  });
});
