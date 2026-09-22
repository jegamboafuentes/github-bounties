import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_EMAIL_FROM,
  emailHealth,
  readEmailFrom,
  readEmailOrigin,
  readResendApiKey,
} from "./env";

describe("email env", () => {
  it("reads RESEND_API_KEY from server env and ignores NEXT_PUBLIC_*", () => {
    assert.equal(readResendApiKey({}), "");
    assert.equal(readResendApiKey({ RESEND_API_KEY: "  " }), "");
    assert.equal(readResendApiKey({ RESEND_API_KEY: " re_test " }), "re_test");
    assert.equal(readResendApiKey({ NEXT_PUBLIC_RESEND_API_KEY: "leaked-to-client" }), "");
    assert.deepEqual(emailHealth({}), { configured: false });
    assert.deepEqual(emailHealth({ RESEND_API_KEY: "re_test" }), { configured: true });
    assert.deepEqual(emailHealth({ NEXT_PUBLIC_RESEND_API_KEY: "leaked-to-client" }), {
      configured: false,
    });
  });

  it("defaults the from address and origin without embedding a secret", () => {
    assert.equal(readEmailFrom({}), DEFAULT_EMAIL_FROM);
    assert.equal(readEmailFrom({ EMAIL_FROM: " GitHub Bounties <hi@example.com> " }), "GitHub Bounties <hi@example.com>");
    assert.equal(readEmailOrigin({}), "https://dev.githubbounties.xyz");
    assert.equal(readEmailOrigin({ PUBLIC_BASE_URL: "https://dev.githubbounties.xyz/path" }), "https://dev.githubbounties.xyz");
    assert.equal(readEmailOrigin({ AUTH_URL: "http://localhost:3000" }), "http://localhost:3000");
  });
});
