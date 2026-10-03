import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitHubHttp } from "../github/api";
import {
  classifyHuggingFaceStatus,
  HF_API,
  HuggingFaceReadError,
  huggingfaceProvider,
  huggingFaceDiscussionUrl,
} from "./huggingface";
import { ProviderNotSupportedError } from "./types";

function http(
  handler: (
    url: string,
    init?: { headers?: Record<string, string> },
  ) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>,
): GitHubHttp {
  return async (url, init) => {
    const result = await handler(url, init);
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.body,
    };
  };
}

function discussion(overrides: Record<string, unknown> = {}) {
  return {
    title: "Which license?",
    status: "open",
    isPullRequest: false,
    author: { _id: "abc", name: "ada" },
    events: [
      {
        type: "comment",
        data: {
          hidden: false,
          latest: { raw: "Hi could you please specify which license is this dataset?" },
        },
      },
    ],
    repo: { name: "stanfordnlp/imdb", type: "dataset" },
    ...overrides,
  };
}

describe("parse Hugging Face discussion URLs", () => {
  it("accepts model, dataset, and space discussions, including /models/", () => {
    const model = huggingfaceProvider.parseIssueUrl(
      "https://huggingface.co/openai-community/gpt2/discussions/189",
    );
    assert.equal(model?.hfRepoType, "model");
    assert.equal(model?.fullName, "openai-community/gpt2");
    assert.equal(model?.issueNumber, 189);
    assert.equal(model?.url, "https://huggingface.co/openai-community/gpt2/discussions/189");

    const prefixed = huggingfaceProvider.parseIssueUrl(
      "https://huggingface.co/models/openai-community/gpt2/discussions/189?diff=1",
    );
    assert.equal(prefixed?.hfRepoType, "model");
    assert.equal(prefixed?.url, huggingFaceDiscussionUrl("model", "openai-community/gpt2", 189));

    const dataset = huggingfaceProvider.parseIssueUrl(
      "https://www.huggingface.co/datasets/stanfordnlp/imdb/discussions/9/",
    );
    assert.equal(dataset?.provider, "huggingface");
    assert.equal(dataset?.hfRepoType, "dataset");
    assert.equal(dataset?.owner, "stanfordnlp");
    assert.equal(dataset?.repo, "imdb");
    assert.equal(dataset?.url, "https://huggingface.co/datasets/stanfordnlp/imdb/discussions/9");

    const space = huggingfaceProvider.parseIssueUrl(
      "https://huggingface.co/spaces/owner/demo/discussions/3#comment",
    );
    assert.equal(space?.hfRepoType, "space");
    assert.equal(space?.url, "https://huggingface.co/spaces/owner/demo/discussions/3");
  });

  it("rejects names, missing discussions, and non-HF URLs", () => {
    assert.equal(huggingfaceProvider.parseIssueUrl(""), null);
    assert.equal(huggingfaceProvider.parseIssueUrl("https://github.com/octo/hello/issues/1"), null);
    assert.equal(huggingfaceProvider.parseIssueUrl("https://huggingface.co/owner/repo"), null);
    assert.equal(huggingfaceProvider.parseIssueUrl("https://huggingface.co/./repo/discussions/1"), null);
    assert.equal(huggingfaceProvider.parseIssueUrl("https://huggingface.co/owner/../discussions/1"), null);
    assert.equal(
      huggingfaceProvider.parseIssueUrl("https://huggingface.co/datasets/owner/repo/discussions/0"),
      null,
    );
  });
});

describe("fetch Hugging Face discussions", () => {
  it("reads an open discussion and prefers the API repo identity", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const ref = huggingfaceProvider.parseIssueUrl(
      "https://huggingface.co/models/other/name/discussions/9",
    );
    assert.ok(ref);
    const fetched = await huggingfaceProvider.fetchIssue(ref, {
      env: { HF_BOT_TOKEN: "  bot-token  " },
      http: http((url, init) => {
        calls.push({ url, authorization: init?.headers?.authorization ?? null });
        return { body: discussion() };
      }),
    });
    assert.equal(calls[0]?.url, `${HF_API}/models/other/name/discussions/9`);
    assert.equal(calls[0]?.authorization, "Bearer bot-token");
    assert.equal(fetched.title, "Which license?");
    assert.equal(fetched.body, "Hi could you please specify which license is this dataset?");
    assert.equal(fetched.state, "open");
    assert.equal(fetched.pullRequest, false);
    assert.equal(fetched.author.id, "abc");
    assert.equal(fetched.author.login, "ada");
    assert.equal(fetched.repo.fullName, "stanfordnlp/imdb");
    assert.equal(fetched.repo.hfRepoType, "dataset");
    assert.equal(fetched.htmlUrl, "https://huggingface.co/datasets/stanfordnlp/imdb/discussions/9");
  });

  it("omits the bearer header when no token is set and hides a hidden first comment", async () => {
    const ref = huggingfaceProvider.parseIssueUrl(
      "https://huggingface.co/datasets/stanfordnlp/imdb/discussions/9",
    );
    assert.ok(ref);
    let authorization: string | undefined = "set";
    const fetched = await huggingfaceProvider.fetchIssue(ref, {
      env: {},
      http: http((_url, init) => {
        authorization = init?.headers?.authorization;
        return {
          body: discussion({
            events: [{ type: "comment", data: { hidden: true, latest: { raw: "secret" } } }],
          }),
        };
      }),
    });
    assert.equal(authorization, undefined);
    assert.equal(fetched.body, null);
  });

  it("refuses pull requests, including merged ones, and closed discussions", async () => {
    const ref = huggingfaceProvider.parseIssueUrl(
      "https://huggingface.co/openai-community/gpt2/discussions/80",
    );
    assert.ok(ref);
    await assert.rejects(
      () =>
        huggingfaceProvider.fetchIssue(ref, {
          env: {},
          http: http(() => ({ body: discussion({ status: "merged", isPullRequest: true, repo: { name: "openai-community/gpt2", type: "model" } }) })),
        }),
      (err: unknown) => err instanceof HuggingFaceReadError && err.code === "hf_not_a_discussion",
    );
    await assert.rejects(
      () =>
        huggingfaceProvider.fetchIssue(ref, {
          env: {},
          http: http(() => ({ body: discussion({ status: "closed", isPullRequest: false }) })),
        }),
      (err: unknown) => err instanceof HuggingFaceReadError && err.code === "hf_discussion_closed",
    );
  });

  it("maps 404, private, rate limit, and timeout", async () => {
    const mapped = classifyHuggingFaceStatus(404, { error: "No discussion found matching num #999999" });
    assert.equal(mapped?.code, "hf_discussion_not_found");
    assert.match(mapped?.message ?? "", /No discussion found/);
    assert.equal(classifyHuggingFaceStatus(401, { error: "unauthorized" })?.code, "hf_discussion_inaccessible");
    assert.equal(classifyHuggingFaceStatus(403, {})?.code, "hf_discussion_inaccessible");
    assert.equal(classifyHuggingFaceStatus(429, { error: "slow down" })?.code, "hf_rate_limited");
    assert.equal(classifyHuggingFaceStatus(500, { message: "boom" })?.code, "hf_unavailable");

    const ref = huggingfaceProvider.parseIssueUrl(
      "https://huggingface.co/datasets/stanfordnlp/imdb/discussions/999999",
    );
    assert.ok(ref);
    await assert.rejects(
      () =>
        huggingfaceProvider.fetchIssue(ref, {
          env: {},
          http: http(() => ({ status: 404, body: { error: "No discussion found matching num #999999" } })),
        }),
      (err: unknown) => err instanceof HuggingFaceReadError && err.code === "hf_discussion_not_found",
    );
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    await assert.rejects(
      () =>
        huggingfaceProvider.fetchIssue(ref, {
          env: {},
          http: async () => {
            throw timeout;
          },
        }),
      (err: unknown) => err instanceof HuggingFaceReadError && err.code === "hf_timeout",
    );
  });

  it("still refuses merge, pull URL, and closing-pull reads", () => {
    assert.throws(
      () => huggingfaceProvider.parsePrUrl("https://huggingface.co/org/model/discussions/1"),
      (err: unknown) => err instanceof ProviderNotSupportedError && err.code === "provider_not_supported",
    );
    assert.throws(
      () =>
        huggingfaceProvider.verifyMerge({
          provider: "huggingface",
          owner: "org",
          repo: "model",
          fullName: "org/model",
          prNumber: 1,
          url: "https://huggingface.co/org/model/discussions/1",
        }),
      (err: unknown) => err instanceof ProviderNotSupportedError && err.code === "provider_not_supported",
    );
    assert.throws(
      () =>
        huggingfaceProvider.listClosingPulls({
          owner: "org",
          repo: "model",
          issueNumber: 1,
        }),
      (err: unknown) => err instanceof ProviderNotSupportedError && err.code === "provider_not_supported",
    );
  });
});
