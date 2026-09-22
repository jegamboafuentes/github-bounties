import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Database } from "../db/client";
import { dispatchEmailOutbox } from "./dispatch";
import { recipientFromSignedUpUser, welcomeIdempotencyKey } from "./outbox";

describe("email dispatch without a provider secret", () => {
  it("does not touch the database or throw when RESEND_API_KEY is absent", async () => {
    const db = {
      execute() {
        throw new Error("db should not be touched");
      },
    } as unknown as Database;
    const missingSecret = await dispatchEmailOutbox({ db, env: {} });
    assert.deepEqual(missingSecret, {
      configured: false,
      reason: "missing_secret",
      claimed: 0,
      sent: 0,
      failed: 0,
      deferred: 0,
    });

    const missingFrom = await dispatchEmailOutbox({
      db,
      env: { RESEND_API_KEY: "re_server" },
    });
    assert.equal(missingFrom.configured, false);
    assert.equal(missingFrom.reason, "missing_from");
    assert.equal(missingFrom.sent, 0);

    const prod = await dispatchEmailOutbox({
      db,
      env: {
        K_SERVICE: "github-bounties-web-prod",
        RESEND_API_KEY: "re_server",
        RESEND_FROM: "GitHub Bounties <notifications@githubbounties.xyz>",
      },
      provider: {
        name: "fake",
        async send() {
          throw new Error("prod must not send");
        },
      },
    });
    assert.equal(prod.reason, "prod_disabled");
    assert.equal(prod.sent, 0);
  });

  it("sends nothing when the outbox claim is empty", async () => {
    let sends = 0;
    const db = {
      async execute() {
        return [];
      },
    } as unknown as Database;
    const result = await dispatchEmailOutbox({
      db,
      env: {},
      provider: {
        name: "fake",
        async send() {
          sends += 1;
          return { ok: true, providerMessageId: "msg" };
        },
      },
    });
    assert.equal(result.configured, true);
    assert.equal(result.claimed, 0);
    assert.equal(sends, 0);
  });
});

describe("signed-up recipient", () => {
  it("accepts only the user email and refuses a missing address", () => {
    assert.equal(recipientFromSignedUpUser({ email: "  pat@example.com  " }), "pat@example.com");
    assert.equal(recipientFromSignedUpUser({ email: "" }), null);
    assert.equal(recipientFromSignedUpUser({ email: "   " }), null);
    assert.equal(recipientFromSignedUpUser({ email: "not-an-email" }), null);
    assert.equal(recipientFromSignedUpUser({ email: "pat@example.com\nBcc: x" }), null);
    assert.equal(recipientFromSignedUpUser({ email: null }), null);
    assert.equal(welcomeIdempotencyKey("00000000-0000-4000-8000-000000000001"), "welcome:user:00000000-0000-4000-8000-000000000001");
  });
});
