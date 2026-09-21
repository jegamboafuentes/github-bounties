import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitHubHttp } from "../github/api";
import type { GeminiHttp } from "./gemini";
import { loadBountyIntelligence } from "./load";

describe("loadBountyIntelligence", () => {
  it("degrades without calling Gemini or GitHub when the key is missing", async () => {
    let github = 0;
    let gemini = 0;
    const githubHttp: GitHubHttp = async () => {
      github += 1;
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const geminiHttp: GeminiHttp = async () => {
      gemini += 1;
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const view = await loadBountyIntelligence({
      bountyId: "11111111-1111-1111-1111-111111111111",
      repoFullName: "octo/hello",
      githubIssueNumber: 1,
      issueTitle: "Bug",
      issueBody: "body",
      installationId: BigInt(9),
      db: {} as never,
      env: {},
      githubHttp,
      geminiHttp,
    });
    assert.equal(view.status, "unavailable");
    if (view.status === "unavailable") assert.equal(view.reason, "missing_key");
    assert.equal(github, 0);
    assert.equal(gemini, 0);
  });
});
