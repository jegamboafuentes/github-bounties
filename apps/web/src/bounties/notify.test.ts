import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitHubHttp } from "../github/api";
import { CLAIM_LABEL, notifyIssueClaimed } from "./notify";

describe("notifyIssueClaimed", () => {
  it("no-ops when the App installation is missing", async () => {
    const result = await notifyIssueClaimed({
      owner: "octo",
      repo: "hello",
      issueNumber: 42,
      installationId: null,
      hunterLabel: "octocat",
      expiresAt: new Date("2026-09-12T12:00:00.000Z"),
    });
    assert.deepEqual(result, {
      attempted: false,
      commentOk: false,
      labelOk: false,
      reason: "no_installation",
    });
  });

  it("posts a comment and label when the installation token works", async () => {
    const calls: string[] = [];
    const http: GitHubHttp = async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/access_tokens")) {
        return { ok: true, status: 201, json: async () => ({ token: "ghs_test" }) };
      }
      return { ok: true, status: 201, json: async () => ({}) };
    };

    const result = await notifyIssueClaimed(
      {
        owner: "octo",
        repo: "hello",
        issueNumber: 42,
        installationId: 4242,
        hunterLabel: "octocat",
        expiresAt: new Date("2026-09-12T12:00:00.000Z"),
      },
      { http, jwt: "unused" },
    );

    assert.equal(result.attempted, true);
    assert.equal(result.commentOk, true);
    assert.equal(result.labelOk, true);
    assert.ok(calls.some((c) => c.includes("/issues/42/comments")));
    assert.ok(calls.some((c) => c.includes("/issues/42/labels")));
    assert.equal(CLAIM_LABEL, "bounty-claimed");
  });

  it("does not throw when GitHub is down", async () => {
    const http: GitHubHttp = async () => {
      throw new Error("network");
    };
    const result = await notifyIssueClaimed(
      {
        owner: "octo",
        repo: "hello",
        issueNumber: 1,
        installationId: 1,
        hunterLabel: "ada",
        expiresAt: new Date("2026-09-12T12:00:00.000Z"),
      },
      { http, jwt: "unused" },
    );
    assert.equal(result.attempted, true);
    assert.equal(result.commentOk, false);
    assert.equal(result.reason, "network");
  });
});
