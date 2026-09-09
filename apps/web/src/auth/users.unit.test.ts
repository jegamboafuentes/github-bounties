import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { identityFromGoogleProfile } from "./users";

describe("Google profile → User identity", () => {
  it("requires google sub + email and skips unverified email", () => {
    assert.equal(identityFromGoogleProfile({}), null);
    assert.equal(identityFromGoogleProfile({ sub: "abc" }), null);
    assert.equal(identityFromGoogleProfile({ email: "a@b.c" }), null);
    assert.equal(
      identityFromGoogleProfile({ sub: "abc", email: "a@b.c", email_verified: false }),
      null,
    );
    assert.deepEqual(
      identityFromGoogleProfile({
        sub: "abc",
        email: "a@b.c",
        name: "Ada",
        email_verified: true,
      }),
      { googleSub: "abc", email: "a@b.c", displayName: "Ada" },
    );
    assert.deepEqual(
      identityFromGoogleProfile({ sub: "abc", email: "pat@example.com" }),
      { googleSub: "abc", email: "pat@example.com", displayName: "pat" },
    );
  });
});
