import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isGithubNoreplyEmail, normalizeSignupEmail } from "./recipients";

describe("signup recipients", () => {
  it("accepts the Google signup mailbox and rejects blank or GitHub noreply", () => {
    assert.equal(normalizeSignupEmail("  Ada@Example.com "), "Ada@Example.com");
    assert.equal(normalizeSignupEmail(""), null);
    assert.equal(normalizeSignupEmail("   "), null);
    assert.equal(normalizeSignupEmail("not-an-email"), null);
    assert.equal(normalizeSignupEmail("123+ada@users.noreply.github.com"), null);
    assert.equal(normalizeSignupEmail("ada@noreply.github.com"), null);
    assert.equal(isGithubNoreplyEmail("Ada@users.noreply.github.com"), true);
    assert.equal(isGithubNoreplyEmail("ada@example.com"), false);
  });
});
