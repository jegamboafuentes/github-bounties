import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyResendStatus, createResendEmailProvider, resolveEmailProvider } from "./resend";

const message = {
  to: "pat@example.com",
  subject: "Welcome to GitHub Bounties",
  html: "<p>Hi</p>",
  text: "Hi",
  idempotencyKey: "welcome:user:1",
};

describe("Resend adapter", () => {
  it("posts JSON with an idempotency key and does not echo the secret on failure", async () => {
    let seen: { url: string; headers: Record<string, string>; body: string } | undefined;
    const provider = createResendEmailProvider({
      apiKey: "re_super_secret",
      from: "GitHub Bounties <notifications@dev.githubbounties.xyz>",
      http: async (url, init) => {
        seen = { url, headers: init?.headers ?? {}, body: init?.body ?? "" };
        return { ok: false, status: 500, json: async () => ({ message: "nope" }) };
      },
    });
    const result = await provider.send(message);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "resend_http_500");
      assert.equal(result.retryable, true);
      assert.equal(result.error.includes("re_super_secret"), false);
    }
    assert.equal(seen?.url, "https://api.resend.com/emails");
    assert.equal(seen?.headers.authorization, "Bearer re_super_secret");
    assert.equal(seen?.headers["idempotency-key"], "welcome:user:1");
    const body = JSON.parse(seen?.body ?? "{}") as { from: string; to: string[]; text: string };
    assert.equal(body.from, "GitHub Bounties <notifications@dev.githubbounties.xyz>");
    assert.deepEqual(body.to, ["pat@example.com"]);
    assert.equal(body.text, "Hi");
  });

  it("returns the provider message id and classifies auth failures as retryable", async () => {
    const provider = createResendEmailProvider({
      apiKey: "re_super_secret",
      from: "GitHub Bounties <notifications@dev.githubbounties.xyz>",
      http: async () => ({ ok: true, status: 200, json: async () => ({ id: "msg_123" }) }),
    });
    const result = await provider.send(message);
    assert.deepEqual(result, { ok: true, providerMessageId: "msg_123" });
    assert.deepEqual(classifyResendStatus(401), { error: "provider_auth", retryable: true });
    assert.deepEqual(classifyResendStatus(422), { error: "resend_http_422", retryable: false });
    assert.equal(resolveEmailProvider({}), null);
    assert.equal(resolveEmailProvider({ NEXT_PUBLIC_RESEND_API_KEY: "leaked-to-client" }), null);
  });

  it("soft-fails network errors without throwing", async () => {
    const provider = createResendEmailProvider({
      apiKey: "re_super_secret",
      from: "GitHub Bounties <notifications@dev.githubbounties.xyz>",
      http: async () => {
        throw new Error("socket hang up");
      },
    });
    const result = await provider.send(message);
    assert.deepEqual(result, { ok: false, error: "resend_fetch", retryable: true });
  });
});
