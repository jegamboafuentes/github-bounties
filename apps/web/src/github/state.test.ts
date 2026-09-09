import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signGitHubConnectState, verifyGitHubConnectState } from "./state";

describe("GitHub connect state", () => {
  it("round-trips a signed user id and rejects tampering / expiry", () => {
    const secret = "state-secret";
    const token = signGitHubConnectState({ userId: "user-1" }, secret);
    const parsed = verifyGitHubConnectState(token, secret);
    assert.equal(parsed?.userId, "user-1");
    assert.ok(parsed?.nonce);

    assert.equal(verifyGitHubConnectState(`${token}x`, secret), null);
    assert.equal(verifyGitHubConnectState(token, "other"), null);

    const expired = signGitHubConnectState(
      { userId: "user-1", now: Date.now() - 40 * 60 * 1000 },
      secret,
    );
    assert.equal(verifyGitHubConnectState(expired, secret), null);
  });
});
