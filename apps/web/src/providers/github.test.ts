import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closingPullToWebhookPayload } from "../bounties/merge-payload";
import { parseGitHubIssueUrl } from "../bounties/parse-issue-url";
import { fetchIssue as fetchInstalledIssue, fetchRepoContext, type GitHubHttp } from "../github/api";
import { fetchPublicPull, listPublicClosingPulls, resolvePublicIssue } from "../github/public-read";
import { githubProvider } from "./github";
import { huggingfaceProvider } from "./huggingface";
import { getProvider } from "./registry";
import { ProviderNotSupportedError } from "./types";

function http(handler: (url: string) => { status?: number; body: unknown }): GitHubHttp {
  return async (url) => {
    const result = handler(url);
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.body,
    };
  };
}

const issueRef = {
  provider: "github" as const,
  owner: "octo",
  repo: "hello",
  fullName: "octo/hello",
  issueNumber: 7,
  url: "https://github.com/octo/hello/issues/7",
};

describe("GithubProvider", () => {
  it("parseIssueUrl matches parseGitHubIssueUrl and tags github", () => {
    const raw = "https://github.com/Octo/Hello/issues/7#note";
    const direct = parseGitHubIssueUrl(raw);
    const parsed = githubProvider.parseIssueUrl(raw);
    assert.deepEqual(parsed, { provider: "github", ...direct });
    assert.equal(githubProvider.parseIssueUrl("https://github.com/octo/hello/pull/3"), null);
  });

  it("parsePrUrl canonicalizes a pull request and rejects an issue", () => {
    assert.deepEqual(githubProvider.parsePrUrl("www.github.com/Octo/Hello/pull/15?w=1"), {
      provider: "github",
      owner: "Octo",
      repo: "Hello",
      fullName: "Octo/Hello",
      prNumber: 15,
      url: "https://github.com/Octo/Hello/pull/15",
    });
    assert.equal(githubProvider.parsePrUrl("https://github.com/octo/hello/issues/7"), null);
    assert.equal(githubProvider.parsePrUrl("https://github.com/octo/hello/pull/0"), null);
  });

  it("fetchIssue matches the public issue read, including author and repo meta", async () => {
    const githubHttp = http((url) => {
      if (url.endsWith("/repos/octo/hello")) {
        return {
          body: {
            id: 99,
            full_name: "octo/hello",
            private: false,
            default_branch: "main",
            description: "A sample",
            created_at: "2020-01-02T00:00:00Z",
            stargazers_count: 12,
            owner: { id: 5, login: "octo" },
          },
        };
      }
      return {
        body: {
          title: "Fix the widget",
          body: "Details",
          state: "open",
          html_url: "https://github.com/octo/hello/issues/7",
          user: { login: "ada", id: 42 },
        },
      };
    });
    const resolved = await resolvePublicIssue("octo", "hello", 7, { env: {}, http: githubHttp });
    const fetched = await githubProvider.fetchIssue(issueRef, { env: {}, http: githubHttp });
    assert.equal(fetched.title, resolved.issue.title);
    assert.equal(fetched.body, resolved.issue.body);
    assert.equal(fetched.state, resolved.issue.state);
    assert.equal(fetched.htmlUrl, resolved.issue.htmlUrl);
    assert.equal(fetched.pullRequest, false);
    assert.equal(fetched.author.login, resolved.issue.authorLogin);
    assert.equal(fetched.author.id, resolved.issue.authorId);
    assert.equal(fetched.repo.githubRepoId, resolved.githubRepoId);
    assert.equal(fetched.repo.fullName, resolved.fullName);
    assert.equal(fetched.repo.defaultBranch, resolved.defaultBranch);
    assert.equal(fetched.repo.createdAt, resolved.createdAt);
    assert.equal(fetched.repo.stars, resolved.stars);
    assert.equal(fetched.repo.ownerLogin, resolved.ownerLogin);
    assert.equal(fetched.repo.description, resolved.description);
  });

  it("fetchIssue on an installation matches fetchIssue from the GitHub client", async () => {
    const githubHttp = http((url) => {
      if (url.includes("/access_tokens")) return { body: { token: "ghs_test" } };
      return {
        body: {
          title: "Installed issue",
          body: "Body",
          state: "open",
          html_url: "https://github.com/octo/hello/issues/7",
          user: { login: "ada", id: 42 },
        },
      };
    });
    const direct = await fetchInstalledIssue("octo", "hello", 7, {
      installationId: 9n,
      http: githubHttp,
      jwt: "test-jwt",
    });
    const fetched = await githubProvider.fetchIssue(issueRef, {
      installationId: 9n,
      http: githubHttp,
      jwt: "test-jwt",
    });
    assert.equal(fetched.title, direct.title);
    assert.equal(fetched.body, direct.body);
    assert.equal(fetched.state, direct.state);
    assert.equal(fetched.htmlUrl, direct.htmlUrl);
    assert.equal(fetched.author.login, direct.authorLogin);
    assert.equal(fetched.author.id, direct.authorId);
    assert.equal(fetched.pullRequest, false);
  });

  it("verifyMerge matches the public pull read", async () => {
    const githubHttp = http((url) => {
      if (url.endsWith("/repos/octo/hello")) {
        return { body: { private: false, default_branch: "main", full_name: "octo/hello" } };
      }
      if (url.endsWith("/commits/abc")) {
        return { body: { commit: { message: "Fix widget (#15)" } } };
      }
      if (url.includes("/pulls/15/commits")) {
        return { body: [{ commit: { message: "Fixes #7" } }] };
      }
      return {
        body: {
          number: 15,
          title: "Fix widget",
          body: "Fixes #7",
          merged: true,
          merged_at: "2026-09-01T00:00:00Z",
          merge_commit_sha: "abc",
          user: { login: "ada", id: 42 },
          merged_by: { login: "octo", id: 5 },
          base: { ref: "main" },
        },
      };
    });
    const pr = githubProvider.parsePrUrl("https://github.com/octo/hello/pull/15");
    assert.ok(pr);
    const direct = await fetchPublicPull({
      owner: "octo",
      repo: "hello",
      prNumber: 15,
      env: {},
      http: githubHttp,
    });
    const verified = await githubProvider.verifyMerge(pr, { env: {}, http: githubHttp });
    assert.equal(verified.merged, direct?.merged);
    assert.equal(verified.author.login, direct?.authorLogin);
    assert.equal(verified.author.id, direct?.authorId != null ? String(direct.authorId) : null);
    assert.equal(verified.merger?.login, direct?.mergedByLogin);
    assert.equal(verified.merger?.id, direct?.mergedById != null ? String(direct.mergedById) : null);
    assert.equal(verified.mergeCommitSha, direct?.mergeCommitSha);
    assert.equal(verified.mergedAt, direct?.mergedAt);
  });

  it("repoMeta matches fetchRepoContext", async () => {
    const githubHttp = http((url) => {
      if (url.endsWith("/repos/octo/hello")) {
        return {
          body: {
            description: "A sample",
            language: "TypeScript",
            private: false,
            created_at: "2020-01-02T00:00:00Z",
            stargazers_count: 3,
            owner: { id: 5, login: "octo" },
          },
        };
      }
      if (url.endsWith("/languages")) return { body: { TypeScript: 10, CSS: 1 } };
      if (url.endsWith("/readme")) {
        return { body: { content: Buffer.from("# Hello").toString("base64"), encoding: "base64" } };
      }
      return { status: 404, body: {} };
    });
    const direct = await fetchRepoContext("octo", "hello", { env: {}, http: githubHttp });
    const meta = await githubProvider.repoMeta({ owner: "octo", repo: "hello" }, { env: {}, http: githubHttp });
    assert.equal(meta.description, direct.description);
    assert.equal(meta.language, direct.language);
    assert.deepEqual(meta.languages, direct.languages);
    assert.equal(meta.readmeBlurb, direct.readmeBlurb);
    assert.equal(meta.private, direct.private);
    assert.equal(meta.createdAt, direct.createdAt);
    assert.equal(meta.stars, direct.stars);
    assert.equal(meta.ownerId, direct.ownerId);
    assert.equal(meta.ownerLogin, direct.ownerLogin);
  });

  it("identitiesMatch is the GitHub login compare", () => {
    const id = (login: string | null) => ({ provider: "github" as const, providerUserId: null, login });
    assert.equal(githubProvider.identitiesMatch(id("Ada"), id("ada")), true);
    assert.equal(githubProvider.identitiesMatch(id("ada"), id("bob")), false);
    assert.equal(githubProvider.identitiesMatch(id("  "), id("ada")), false);
    assert.equal(githubProvider.identitiesMatch(id(null), id(null)), false);
  });

  it("listClosingPulls and mergeDeliveryPayload match the existing helpers", async () => {
    const githubHttp = http((url) => {
      if (url.endsWith("/repos/octo/hello")) {
        return { body: { private: false, default_branch: "main", full_name: "octo/hello" } };
      }
      if (url.includes("/issues/7/timeline")) {
        return {
          body: [
            {
              event: "cross-referenced",
              source: {
                issue: {
                  number: 15,
                  pull_request: {},
                  repository: { full_name: "octo/hello" },
                },
              },
            },
          ],
        };
      }
      if (url.includes("/search/issues")) return { body: { items: [] } };
      if (url.endsWith("/commits/abc")) return { body: { commit: { message: "Fix (#15)" } } };
      if (url.includes("/pulls/15/commits")) return { body: [{ commit: { message: "Fixes #7" } }] };
      if (url.endsWith("/pulls/15")) {
        return {
          body: {
            number: 15,
            title: "Fix",
            body: "Fixes #7",
            merged: true,
            merged_at: "2026-09-01T00:00:00Z",
            merge_commit_sha: "abc",
            user: { login: "ada", id: 42 },
            base: { ref: "main" },
          },
        };
      }
      return { status: 404, body: { message: "Not Found" } };
    });
    const args = { owner: "octo", repo: "hello", issueNumber: 7, env: {}, http: githubHttp };
    const direct = await listPublicClosingPulls(args);
    const wrapped = await githubProvider.listClosingPulls(args);
    assert.deepEqual(wrapped, direct);
    const pull = wrapped[0];
    assert.ok(pull);
    assert.deepEqual(
      githubProvider.mergeDeliveryPayload("octo/hello", pull),
      closingPullToWebhookPayload("octo/hello", pull),
    );
  });
});

describe("getProvider", () => {
  it("returns the GitHub adapter and a Hugging Face stub that refuses", () => {
    assert.equal(getProvider("github"), githubProvider);
    assert.equal(getProvider("huggingface"), huggingfaceProvider);
    assert.throws(
      () => huggingfaceProvider.parseIssueUrl("https://huggingface.co/org/model/discussions/1"),
      (err: unknown) => err instanceof ProviderNotSupportedError && err.code === "provider_not_supported",
    );
    assert.throws(
      () => getProvider("gitlab"),
      (err: unknown) => err instanceof ProviderNotSupportedError && err.code === "provider_not_supported",
    );
  });
});
