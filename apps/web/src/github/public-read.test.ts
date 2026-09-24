import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitHubHttp } from "./api";
import {
  classifyPublicGitHubStatus,
  listPublicClosingPulls,
  PublicGitHubError,
  resolvePublicIssue,
} from "./public-read";

function http(handler: (url: string, method?: string) => { status?: number; body: unknown }): GitHubHttp {
  return async (url, init) => {
    const result = handler(url, init?.method);
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.body,
    };
  };
}

describe("classifyPublicGitHubStatus", () => {
  it("maps 404, private 401/403, and rate limits", () => {
    assert.equal(classifyPublicGitHubStatus(200, {})?.code, undefined);
    assert.equal(classifyPublicGitHubStatus(404, { message: "Not Found" })?.code, "not_found");
    assert.equal(classifyPublicGitHubStatus(401, { message: "Bad credentials" })?.code, "inaccessible");
    assert.equal(classifyPublicGitHubStatus(403, { message: "Resource not accessible" })?.code, "inaccessible");
    assert.equal(classifyPublicGitHubStatus(429, { message: "slow down" })?.code, "rate_limited");
    assert.equal(
      classifyPublicGitHubStatus(403, {
        message: "API rate limit exceeded for 1.2.3.4.",
      })?.code,
      "rate_limited",
    );
    assert.equal(classifyPublicGitHubStatus(500, { message: "boom" })?.code, "unavailable");
  });
});

describe("resolvePublicIssue", () => {
  it("reads an open public issue without an installation token", async () => {
    const calls: string[] = [];
    const resolved = await resolvePublicIssue("android", "architecture-samples", 1080, {
      env: {},
      http: http((url) => {
        calls.push(url);
        if (url.endsWith("/repos/android/architecture-samples")) {
          return {
            body: {
              id: 12345,
              full_name: "android/architecture-samples",
              private: false,
              default_branch: "main",
            },
          };
        }
        return {
          body: {
            title: "Migrate samples",
            body: "Please update the sample.",
            state: "open",
            html_url: "https://github.com/android/architecture-samples/issues/1080",
          },
        };
      }),
    });
    assert.equal(resolved.githubRepoId, BigInt(12345));
    assert.equal(resolved.fullName, "android/architecture-samples");
    assert.equal(resolved.issue.state, "open");
    assert.equal(resolved.issue.title, "Migrate samples");
    assert.equal(calls.some((url) => url.includes("access_tokens")), false);
  });

  it("returns a closed issue so the poster path can reject it", async () => {
    const resolved = await resolvePublicIssue("octo", "hello", 4, {
      env: {},
      http: http((url) => {
        if (url.endsWith("/repos/octo/hello")) {
          return { body: { id: 9, full_name: "octo/hello", private: false, default_branch: "main" } };
        }
        return { body: { title: "Done", body: null, state: "closed" } };
      }),
    });
    assert.equal(resolved.issue.state, "closed");
  });

  it("rejects a pull request that shares the issue number", async () => {
    await assert.rejects(
      () =>
        resolvePublicIssue("octo", "hello", 8, {
          env: {},
          http: http((url) => {
            if (url.endsWith("/repos/octo/hello")) {
              return { body: { id: 9, full_name: "octo/hello", private: false, default_branch: "main" } };
            }
            return { body: { title: "PR", state: "open", pull_request: { url: "https://api.github.com/pulls/8" } } };
          }),
        }),
      (err: unknown) => err instanceof PublicGitHubError && err.code === "not_an_issue",
    );
  });

  it("rejects private repos and missing or forbidden resources", async () => {
    await assert.rejects(
      () =>
        resolvePublicIssue("octo", "secret", 1, {
          env: {},
          http: http(() => ({
            body: { id: 3, full_name: "octo/secret", private: true, default_branch: "main" },
          })),
        }),
      (err: unknown) => err instanceof PublicGitHubError && err.code === "inaccessible",
    );

    await assert.rejects(
      () =>
        resolvePublicIssue("octo", "missing", 1, {
          env: {},
          http: http(() => ({ status: 404, body: { message: "Not Found" } })),
        }),
      (err: unknown) => err instanceof PublicGitHubError && err.code === "not_found",
    );

    await assert.rejects(
      () =>
        resolvePublicIssue("octo", "hidden", 1, {
          env: {},
          http: http(() => ({ status: 401, body: { message: "Bad credentials" } })),
        }),
      (err: unknown) => err instanceof PublicGitHubError && err.code === "inaccessible",
    );

    await assert.rejects(
      () =>
        resolvePublicIssue("octo", "hello", 1, {
          env: {},
          http: http(() => ({ status: 403, body: { message: "API rate limit exceeded for 0.0.0.0." } })),
        }),
      (err: unknown) => err instanceof PublicGitHubError && err.code === "rate_limited",
    );
  });
});

describe("listPublicClosingPulls", () => {
  it("loads a merged PR from the public timeline and commit messages", async () => {
    const pulls = await listPublicClosingPulls({
      owner: "android",
      repo: "architecture-samples",
      issueNumber: 1080,
      env: {},
      http: http((url) => {
        if (url.endsWith("/repos/android/architecture-samples")) {
          return { body: { private: false, default_branch: "main", full_name: "android/architecture-samples" } };
        }
        if (url.includes("/issues/1080/timeline")) {
          return {
            body: [
              {
                event: "cross-referenced",
                source: {
                  issue: {
                    number: 12,
                    pull_request: {},
                    repository: { full_name: "android/architecture-samples" },
                  },
                },
              },
              {
                event: "cross-referenced",
                source: {
                  issue: {
                    number: 99,
                    pull_request: {},
                    repository: { full_name: "other/repo" },
                  },
                },
              },
            ],
          };
        }
        if (url.includes("/search/issues")) return { body: { items: [] } };
        if (url.endsWith("/pulls/12")) {
          return {
            body: {
              number: 12,
              title: "Update samples",
              body: "Fixes #1080",
              merged: true,
              merged_at: "2026-09-24T00:00:00Z",
              html_url: "https://github.com/android/architecture-samples/pull/12",
              merge_commit_sha: "abc",
              user: { login: "ada", id: 42 },
              base: { ref: "main" },
            },
          };
        }
        if (url.endsWith("/commits/abc")) {
          return { body: { commit: { message: "Update samples (#12)" } } };
        }
        if (url.includes("/pulls/12/commits")) {
          return { body: [{ commit: { message: "Fixes #1080" } }] };
        }
        return { status: 404, body: { message: "Not Found" } };
      }),
    });
    assert.equal(pulls.length, 1);
    assert.equal(pulls[0]?.number, 12);
    assert.equal(pulls[0]?.authorLogin, "ada");
    assert.equal(pulls[0]?.baseRef, "main");
    assert.deepEqual(pulls[0]?.commitMessages, ["Fixes #1080"]);
    assert.equal(pulls[0]?.mergeCommitMessage, "Update samples (#12)");
  });
});
