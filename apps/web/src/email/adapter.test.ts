import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createResendAdapter, type ResendHttp } from "./adapter";

const message = {
  to: "ada@example.com",
  subject: "Welcome",
  html: "<p>Hi</p>",
  text: "Hi",
  idempotencyKey: "welcome:user-1",
};

describe("Resend adapter", () => {
  it("soft-fails when the provider secret is missing and does not call the network", async () => {
    let calls = 0;
    const http: ResendHttp = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ id: "re_should_not_send" }) };
    };
    const adapter = createResendAdapter({
      env: { NEXT_PUBLIC_RESEND_API_KEY: "leaked-to-client" },
      http,
    });
    const result = await adapter.send(message);
    assert.deepEqual(result, { ok: false, reason: "missing_secret" });
    assert.equal(calls, 0);
  });

  it("sends with the server key and idempotency header, never the key in the body", async () => {
    const seen: { url?: string; headers?: Record<string, string>; body?: string }[] = [];
    const http: ResendHttp = async (url, init) => {
      seen.push({ url, headers: init?.headers, body: init?.body });
      return { ok: true, status: 200, json: async () => ({ id: "re_123" }) };
    };
    const adapter = createResendAdapter({
      env: {
        RESEND_API_KEY: "re_server_only",
        EMAIL_FROM: "GitHub Bounties <noreply@githubbounties.xyz>",
      },
      http,
    });
    const result = await adapter.send(message);
    assert.deepEqual(result, { ok: true, providerMessageId: "re_123" });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.url, "https://api.resend.com/emails");
    assert.equal(seen[0]?.headers?.authorization, "Bearer re_server_only");
    assert.equal(seen[0]?.headers?.["idempotency-key"], "welcome:user-1");
    assert.equal(seen[0]?.headers?.["NEXT_PUBLIC_RESEND_API_KEY"], undefined);
    const body = seen[0]?.body ?? "";
    assert.equal(body.includes("re_server_only"), false);
    assert.match(body, /ada@example.com/);
    assert.match(body, /noreply@githubbounties.xyz/);
  });
});
