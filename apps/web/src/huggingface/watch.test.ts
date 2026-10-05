import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitHubHttp } from "../github/api";
import { ensureHfRepoWatched } from "./watch";

describe("Hugging Face watch sync", () => {
  it("does not call the Hub when the flag is off", async () => {
    let calls = 0;
    const result = await ensureHfRepoWatched(
      { type: "dataset", fullName: "acme/imdb" },
      {
        env: { HF_BOT_TOKEN: "token" },
        http: async () => {
          calls += 1;
          throw new Error("hub");
        },
      },
    );
    assert.equal(result.reason, "disabled");
    assert.equal(calls, 0);
  });

  it("adds the repo and the discussion domain without logging the secret", async () => {
    const logs: string[] = [];
    const calls: Array<{ url: string; body?: string }> = [];
    const http: GitHubHttp = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith("/settings/webhooks") && !init?.method) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: "wh_1",
              url: "https://dev.githubbounties.xyz/webhooks/huggingface",
              secret: "do-not-log",
              watched: [{ type: "model", name: "other/model" }],
              domains: ["repo"],
            },
          ],
        };
      }
      return { ok: true, status: 200, json: async () => ({ secret: "do-not-log" }) };
    };
    const result = await ensureHfRepoWatched(
      { type: "dataset", fullName: "acme/imdb" },
      { env: { HF_BOUNTIES_ENABLED: "1", HF_BOT_TOKEN: "bot-token" }, http, log: (line) => logs.push(line) },
    );
    assert.equal(result.reason, "updated");
    const update = calls.find((call) => call.url.endsWith("/wh_1"));
    const body = JSON.parse(update?.body ?? "{}") as { watched: Array<{ name: string }>; domains: string[] };
    assert.equal(body.watched.some((item) => item.name === "acme/imdb"), true);
    assert.equal(body.domains.includes("discussion"), true);
    assert.equal(body.domains.includes("repo"), true);
    assert.equal(JSON.stringify(logs).includes("do-not-log"), false);
    assert.equal(JSON.stringify(logs).includes("bot-token"), false);
  });
});
