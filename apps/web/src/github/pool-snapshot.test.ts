import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitHubHttp } from "./api";
import {
  fetchPoolPullRequests,
  poolPullRequestFromWebhook,
} from "./pool-snapshot";
import type { GitHubWebhookPayload } from "../webhooks/types";

function jsonOk(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body };
}

describe("poolPullRequestFromWebhook", () => {
  it("maps draft / fork / bot fields from the REST payload", () => {
    const payload: GitHubWebhookPayload = {
      action: "opened",
      pull_request: {
        number: 10,
        title: "Hunt",
        body: "Refs #42",
        draft: true,
        created_at: "2026-09-17T11:00:00.000Z",
        html_url: "https://github.com/bounty/repo/pull/10",
        user: { login: "alice", id: 10, type: "User" },
        base: { repo: { full_name: "bounty/repo" } },
        head: { repo: { full_name: "alice/repo" } },
      },
      repository: { full_name: "bounty/repo" },
    };
    const pr = poolPullRequestFromWebhook(payload);
    assert.equal(pr?.draft, true);
    assert.equal(pr?.authorId, 10);
    assert.equal(pr?.headRepositoryFullName, "alice/repo");
    assert.equal(pr?.baseRepositoryFullName, "bounty/repo");
  });
});

describe("fetchPoolPullRequests", () => {
  it("snapshots commit authors at freeze and ignores a cross-repo timeline PR", async () => {
    const http: GitHubHttp = async (url, init) => {
      if (url.includes("/app/installations/7/access_tokens")) {
        return jsonOk({ token: "ghs_test" }, 201);
      }
      if (url.includes("/search/issues")) {
        return jsonOk({
          items: [
            { number: 10, pull_request: {} },
            { number: 100, pull_request: {} },
          ],
        });
      }
      if (url.includes("/issues/42/timeline")) {
        return jsonOk([
          {
            event: "cross-referenced",
            source: {
              issue: {
                number: 19,
                pull_request: {},
                html_url: "https://github.com/other/repo/pull/19",
                repository: { full_name: "other/repo" },
              },
            },
          },
          {
            event: "cross-referenced",
            source: {
              issue: {
                number: 10,
                pull_request: {},
                html_url: "https://github.com/bounty/repo/pull/10",
                repository: { full_name: "bounty/repo" },
              },
            },
          },
        ]);
      }
      if (url.endsWith("/pulls/10") && !url.includes("/commits")) {
        return jsonOk({
          number: 10,
          title: "Hunt",
          body: "Refs #42",
          created_at: "2026-09-17T11:00:00.000Z",
          html_url: "https://github.com/bounty/repo/pull/10",
          draft: true,
          merged: false,
          state: "open",
          user: { login: "alice", id: 10, type: "User" },
          base: { repo: { full_name: "bounty/repo" } },
          head: { repo: { full_name: "alice/repo" } },
        });
      }
      if (url.includes("/pulls/10/commits")) {
        return jsonOk([
          {
            sha: "aaa111",
            author: { login: "alice", id: 10, type: "User" },
            commit: { message: "wip" },
          },
        ]);
      }
      if (url.endsWith("/pulls/100") && !url.includes("/commits")) {
        return jsonOk({
          number: 100,
          title: "Close funded issue",
          body: "Fixes #42",
          created_at: "2026-09-17T10:00:00.000Z",
          merged: true,
          state: "closed",
          user: { login: "winner", id: 2, type: "User" },
          base: { repo: { full_name: "bounty/repo" } },
          head: { repo: { full_name: "winner/repo" } },
        });
      }
      if (url.includes("/pulls/100/commits")) {
        return jsonOk([
          {
            sha: "win100",
            author: { login: "winner", id: 2, type: "User" },
            commit: { message: "Fixes #42" },
          },
        ]);
      }
      if (url.includes("/pulls/19")) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({ url, method: init?.method }) };
    };

    const pulls = await fetchPoolPullRequests({
      owner: "bounty",
      repo: "repo",
      issueNumber: 42,
      installationId: 7,
      includePullNumbers: [100],
      http,
      jwt: "fake-jwt",
    });

    assert.deepEqual(
      pulls.map((p) => p.number).sort((a, b) => a - b),
      [10, 100],
    );
    const alice = pulls.find((p) => p.number === 10);
    assert.equal(alice?.draft, true);
    assert.equal(alice?.headRepositoryFullName, "alice/repo");
    assert.deepEqual(alice?.commitAuthorsAtFreeze, [{ login: "alice", githubId: 10 }]);
    assert.equal(alice?.commitsAtFreeze?.[0]?.sha, "aaa111");
    assert.equal(
      pulls.some((p) => p.baseRepositoryFullName === "other/repo"),
      false,
    );
  });

  it("force-push: freeze commit list can be empty of the PR author", async () => {
    const http: GitHubHttp = async (url) => {
      if (url.includes("/access_tokens")) return jsonOk({ token: "ghs_test" }, 201);
      if (url.includes("/search/issues")) return jsonOk({ items: [{ number: 17, pull_request: {} }] });
      if (url.includes("/timeline")) return jsonOk([]);
      if (url.endsWith("/pulls/17") && !url.includes("/commits")) {
        return jsonOk({
          number: 17,
          title: "Force-push lost",
          body: "Refs #42",
          created_at: "2026-09-17T11:00:00.000Z",
          user: { login: "gina", id: 16, type: "User" },
          base: { repo: { full_name: "bounty/repo" } },
          head: { repo: { full_name: "gina/repo" } },
        });
      }
      if (url.includes("/pulls/17/commits")) return jsonOk([]);
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const pulls = await fetchPoolPullRequests({
      owner: "bounty",
      repo: "repo",
      issueNumber: 42,
      installationId: 1,
      http,
      jwt: "fake-jwt",
    });
    assert.equal(pulls[0]?.commitAuthorsAtFreeze.length, 0);
    assert.deepEqual(pulls[0]?.commitsAtFreeze, []);
  });
});
