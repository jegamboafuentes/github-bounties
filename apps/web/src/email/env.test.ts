import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEV_EMAIL_BASE_URL,
  emailHealth,
  emailNotConfiguredReason,
  normalizeHttpBaseUrl,
  readEmailBaseUrl,
  readResendApiKey,
  readResendFrom,
  transactionalEmailEnabled,
} from "./env";

describe("transactional email env", () => {
  it("reads RESEND_API_KEY from server env and ignores NEXT_PUBLIC_*", () => {
    assert.equal(readResendApiKey({}), "");
    assert.equal(readResendApiKey({ RESEND_API_KEY: "  " }), "");
    assert.equal(readResendApiKey({ RESEND_API_KEY: "re_server" }), "re_server");
    assert.equal(readResendApiKey({ NEXT_PUBLIC_RESEND_API_KEY: "leaked-to-client" }), "");
    assert.equal(
      readResendApiKey({
        NEXT_PUBLIC_RESEND_API_KEY: "leaked-to-client",
        RESEND_API_KEY: "re_server",
      }),
      "re_server",
    );
  });

  it("requires a single-line from address and treats a missing secret as non-fatal", () => {
    assert.equal(readResendFrom({}), "");
    assert.equal(readResendFrom({ RESEND_FROM: "not-an-address" }), "");
    assert.equal(readResendFrom({ RESEND_FROM: "GitHub Bounties <a@dev.githubbounties.xyz>\nBcc: x" }), "");
    assert.equal(
      readResendFrom({ RESEND_FROM: "GitHub Bounties <notifications@dev.githubbounties.xyz>" }),
      "GitHub Bounties <notifications@dev.githubbounties.xyz>",
    );
    assert.equal(emailNotConfiguredReason({}), "missing_secret");
    assert.equal(emailNotConfiguredReason({ RESEND_API_KEY: "re_server" }), "missing_from");
    assert.equal(
      emailNotConfiguredReason({
        RESEND_API_KEY: "re_server",
        RESEND_FROM: "GitHub Bounties <notifications@dev.githubbounties.xyz>",
      }),
      null,
    );
    assert.deepEqual(emailHealth({}), { configured: false });
    assert.deepEqual(emailHealth({ NEXT_PUBLIC_RESEND_API_KEY: "leaked-to-client" }), {
      configured: false,
    });
    assert.deepEqual(
      emailHealth({
        RESEND_API_KEY: "re_server",
        RESEND_FROM: "GitHub Bounties <notifications@dev.githubbounties.xyz>",
      }),
      { configured: true },
    );
  });

  it("builds absolute DEV links without assuming the production apex", () => {
    assert.equal(normalizeHttpBaseUrl("javascript:alert(1)"), null);
    assert.equal(normalizeHttpBaseUrl("https://dev.githubbounties.xyz/board"), "https://dev.githubbounties.xyz");
    assert.equal(readEmailBaseUrl({}), DEV_EMAIL_BASE_URL);
    assert.equal(readEmailBaseUrl({}), "https://dev.githubbounties.xyz");
    assert.equal(
      readEmailBaseUrl({ PUBLIC_BASE_URL: "https://dev.githubbounties.xyz/" }),
      "https://dev.githubbounties.xyz",
    );
    assert.equal(readEmailBaseUrl({ AUTH_URL: "http://localhost:3000" }), "http://localhost:3000");
    assert.equal(transactionalEmailEnabled({}), true);
    assert.equal(transactionalEmailEnabled({ K_SERVICE: "github-bounties-web" }), true);
    assert.equal(transactionalEmailEnabled({ K_SERVICE: "github-bounties-web-prod" }), false);
    assert.equal(transactionalEmailEnabled({ APP_ENV: "prod" }), false);
    assert.equal(transactionalEmailEnabled({ AUTH_URL: "https://githubbounties.xyz" }), false);
    assert.equal(transactionalEmailEnabled({ PUBLIC_BASE_URL: "https://dev.githubbounties.xyz" }), true);
  });
});
