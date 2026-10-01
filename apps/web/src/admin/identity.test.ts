import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAdminIdentity, parseAdminEmails } from "./identity";

describe("admin identity", () => {
  it("lets nobody in when ADMIN_EMAILS is unset", () => {
    assert.equal(parseAdminEmails(undefined).size, 0);
    assert.equal(parseAdminEmails("  ").size, 0);
    assert.equal(isAdminIdentity({ email: "a@b.c", googleSub: "sub" }, {}), false);
  });

  it("compares emails in lowercase and pins the Google subject", () => {
    const env = { ADMIN_EMAILS: " Ada@Example.com, other@example.com " };
    assert.equal(
      isAdminIdentity({ email: "ada@example.com", googleSub: "sub-1", sessionGoogleSub: "sub-1" }, env),
      true,
    );
    assert.equal(
      isAdminIdentity({ email: "ADA@example.com", googleSub: "sub-1", sessionGoogleSub: "other" }, env),
      false,
    );
    assert.equal(isAdminIdentity({ email: "stranger@example.com", googleSub: "sub-1" }, env), false);
  });
});
