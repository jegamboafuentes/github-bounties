import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Database } from "../db/client";
import { handleHuggingFaceWebhook, huggingFaceWebhookTarget } from "./webhook";

const secret = "hf-secret";

function headers(extra: Record<string, string> = {}): Headers {
  return new Headers({ "x-webhook-secret": secret, "webhook-id": "delivery-1", ...extra });
}

describe("Hugging Face webhook auth", () => {
  it("fails closed without a secret and rejects a bad secret", async () => {
    const missing = await handleHuggingFaceWebhook(
      { headers: headers(), body: "{}" },
      { db: {} as Database, env: {} },
    );
    assert.equal(missing.status, 503);
    assert.equal(missing.body.error, "missing_hf_webhook_secret");

    const bad = await handleHuggingFaceWebhook(
      { headers: headers({ "x-webhook-secret": "nope" }), body: "{}" },
      { db: {} as Database, env: { HF_WEBHOOK_SECRET: secret, HF_BOUNTIES_ENABLED: "1" } },
    );
    assert.equal(bad.status, 401);
  });

  it("returns 200 and does not call the Hub when the flag is off", async () => {
    let calls = 0;
    const result = await handleHuggingFaceWebhook(
      {
        headers: headers(),
        body: JSON.stringify({
          event: { action: "update", scope: "discussion" },
          repo: { type: "dataset", name: "acme/imdb" },
          discussion: { num: 12, isPullRequest: true, status: "merged" },
        }),
      },
      {
        db: {} as Database,
        env: { HF_WEBHOOK_SECRET: secret },
        http: async () => {
          calls += 1;
          throw new Error("hub");
        },
      },
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.skipped, "hf_disabled");
    assert.equal(calls, 0);
  });

  it("ignores an open pull request without reading the Hub", () => {
    assert.equal(
      huggingFaceWebhookTarget({
        event: { action: "update", scope: "discussion" },
        repo: { type: "model", name: "acme/model" },
        discussion: { num: 3, isPullRequest: true, status: "open" },
      }).ignore,
      true,
    );
  });
});
