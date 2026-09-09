import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAuthSecret } from "../auth/env";
import { completeGitHubAppReturn } from "./complete";
import { signGitHubConnectState } from "./state";
import type { GitHubHttp } from "./api";

describe("completeGitHubAppReturn", () => {
  it("rejects missing or mismatched state without calling GitHub", async () => {
    const missing = await completeGitHubAppReturn({
      userId: "user-1",
      state: null,
      installationId: "9",
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error, "invalid_state");

    const token = signGitHubConnectState({ userId: "other" }, resolveAuthSecret());
    const mismatch = await completeGitHubAppReturn({
      userId: "user-1",
      state: token,
      installationId: "9",
    });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.error, "state_user_mismatch");
  });

  it("confirms installation via the App API and upserts repos (mocked HTTP)", async () => {
    const calls: string[] = [];
    const http: GitHubHttp = async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/app/installations/77/access_tokens")) {
        return { ok: true, status: 201, json: async () => ({ token: "ghs_test" }) };
      }
      if (url.includes("/app/installations/77")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 77,
            account: { login: "octocat", id: 1, type: "User" },
          }),
        };
      }
      if (url.includes("/installation/repositories")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            repositories: [{ id: 1296269, full_name: "octo/hello" }],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const saved: Array<{ fullName: string }> = [];
    const db = {
      insert() {
        return {
          values() {
            return {
              onConflictDoUpdate() {
                return {
                  returning: async () => {
                    saved.push({ fullName: "octo/hello" });
                    return [
                      {
                        id: "repo-1",
                        fullName: "octo/hello",
                        githubRepoId: BigInt(1296269),
                      },
                    ];
                  },
                };
              },
            };
          },
        };
      },
      update() {
        return {
          set() {
            return {
              where: async () => undefined,
            };
          },
        };
      },
    };

    const state = signGitHubConnectState({ userId: "user-1" }, resolveAuthSecret());
    const result = await completeGitHubAppReturn(
      {
        userId: "user-1",
        state,
        installationId: "77",
      },
      { db: db as never, http, jwt: "test-app-jwt" },
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.installationId, "77");
      assert.equal(result.repos[0]?.fullName, "octo/hello");
      assert.equal(result.next, "oauth");
      assert.ok(result.oauthUrl?.includes("github.com/login/oauth/authorize"));
    }
    assert.ok(calls.some((c) => c.includes("/app/installations/77")));
    assert.ok(saved.length >= 1);
  });
});
