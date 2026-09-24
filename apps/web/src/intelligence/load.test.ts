import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitHubHttp } from "../github/api";
import { intelligenceFingerprint } from "./cache";
import type { GeminiHttp } from "./gemini";
import type { IntelligenceCachePort } from "./load";
import { loadBountyIntelligence, readCachedBountyIntelligence } from "./load";

const BOUNTY_ID = "11111111-1111-1111-1111-111111111111";

function silentGithub(): GitHubHttp {
  return async () => ({ ok: false, status: 500, json: async () => ({}) });
}

function geminiOk(): GeminiHttp {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: '{"repoAbout":"Widgets","languageStack":"TS","complexity":"S"}' }],
          },
        },
      ],
    }),
  });
}

function geminiHttp(status: number): GeminiHttp {
  return async () => ({ ok: false, status, json: async () => ({ error: "nope" }) });
}

function missingTableError(): Error {
  return Object.assign(new Error('relation "bounty_intelligence" does not exist'), {
    code: "42P01",
  });
}

describe("loadBountyIntelligence", () => {
  it("degrades without calling Gemini or GitHub when the key is missing", async () => {
    let github = 0;
    let gemini = 0;
    const githubHttp: GitHubHttp = async () => {
      github += 1;
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const geminiHttpFn: GeminiHttp = async () => {
      gemini += 1;
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const view = await loadBountyIntelligence({
      bountyId: BOUNTY_ID,
      repoFullName: "octo/hello",
      githubIssueNumber: 1,
      issueTitle: "Bug",
      issueBody: "body",
      installationId: BigInt(9),
      db: {} as never,
      env: {},
      githubHttp,
      geminiHttp: geminiHttpFn,
    });
    assert.equal(view.status, "unavailable");
    if (view.status === "unavailable") {
      assert.equal(view.reason, "missing_key");
      assert.equal(view.errorReason, "missing_key");
    }
    assert.equal(github, 0);
    assert.equal(gemini, 0);
  });

  it("still returns ready intel when cache write fails (missing table)", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: unknown) => {
      lines.push(String(line));
    };
    const cache: IntelligenceCachePort = {
      read: async () => {
        throw missingTableError();
      },
      write: async () => {
        throw missingTableError();
      },
    };
    try {
      const view = await loadBountyIntelligence({
        bountyId: BOUNTY_ID,
        repoFullName: "octo/hello",
        githubIssueNumber: 1,
        issueTitle: "Bug",
        issueBody: "body",
        installationId: BigInt(9),
        db: {} as never,
        env: { GEMINI_API_KEY: "k" },
        githubHttp: silentGithub(),
        geminiHttp: geminiOk(),
        cache,
      });
      assert.equal(view.status, "ready");
      if (view.status === "ready") {
        assert.equal(view.complexity, "S");
        assert.equal(view.languageStack, "TS");
      }
    } finally {
      console.error = original;
    }
    const events = lines.map((line) => JSON.parse(line) as { event: string; error?: string });
    assert.ok(events.some((row) => row.event === "bounty_intelligence_cache_read_failed"));
    assert.ok(events.some((row) => row.event === "bounty_intelligence_cache_write_failed"));
    assert.ok(events.every((row) => row.error === "missing_table"));
    assert.ok(lines.every((line) => !line.includes("k")));
  });

  it("surfaces gemini_http codes when Gemini fails and still logs cache write errors", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: unknown) => {
      lines.push(String(line));
    };
    const cache: IntelligenceCachePort = {
      read: async () => null,
      write: async () => {
        throw missingTableError();
      },
    };
    try {
      const view = await loadBountyIntelligence({
        bountyId: BOUNTY_ID,
        repoFullName: "octo/hello",
        githubIssueNumber: 1,
        issueTitle: "Bug",
        issueBody: "body",
        installationId: BigInt(9),
        db: {} as never,
        env: { GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-2.5-flash" },
        githubHttp: silentGithub(),
        geminiHttp: geminiHttp(404),
        cache,
      });
      assert.equal(view.status, "unavailable");
      if (view.status === "unavailable") {
        assert.equal(view.reason, "error");
        assert.equal(view.errorReason, "missing_table");
      }
    } finally {
      console.error = original;
    }
    const events = lines.map(
      (line) => JSON.parse(line) as { event: string; error?: string; model?: string },
    );
    assert.ok(
      events.some(
        (row) => row.event === "bounty_intelligence_gemini_failed" && row.error === "gemini_http_404",
      ),
    );
    assert.ok(events.some((row) => row.event === "bounty_intelligence_cache_write_failed"));
    assert.ok(events.some((row) => row.model === "gemini-2.5-flash"));
  });

  it("skips a stale error cache when refreshIntelligence is forced", async () => {
    let reads = 0;
    let writes = 0;
    const cache: IntelligenceCachePort = {
      read: async () => {
        reads += 1;
        return {
          bountyId: BOUNTY_ID,
          repoAbout: null,
          languageStack: null,
          complexity: null,
          model: "gemini-2.5-flash",
          sourceFingerprint: "abc",
          status: "error",
          errorReason: "gemini_http_500",
          generatedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
      write: async () => {
        writes += 1;
      },
    };
    const view = await loadBountyIntelligence({
      bountyId: BOUNTY_ID,
      repoFullName: "octo/hello",
      githubIssueNumber: 1,
      issueTitle: "Bug",
      issueBody: "body",
      installationId: BigInt(9),
      db: {} as never,
      env: { GEMINI_API_KEY: "k" },
      githubHttp: silentGithub(),
      geminiHttp: geminiOk(),
      cache,
      forceRefresh: true,
    });
    assert.equal(reads, 0);
    assert.equal(writes, 1);
    assert.equal(view.status, "ready");
  });

  it("returns a cached error reason until refresh or TTL", async () => {
    let gemini = 0;
    const cache: IntelligenceCachePort = {
      read: async () => ({
        bountyId: BOUNTY_ID,
        repoAbout: null,
        languageStack: null,
        complexity: null,
        model: null,
        sourceFingerprint: intelligenceFingerprint({
          issueBody: "body",
          repoAbout: null,
          languages: [],
          readmeBlurb: null,
        }),
        status: "error",
        errorReason: "gemini_timeout",
        generatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      write: async () => {
        throw new Error("write should not run");
      },
    };
    const view = await loadBountyIntelligence({
      bountyId: BOUNTY_ID,
      repoFullName: "octo/hello",
      githubIssueNumber: 1,
      issueTitle: "Bug",
      issueBody: "body",
      installationId: BigInt(9),
      db: {} as never,
      env: { GEMINI_API_KEY: "k" },
      githubHttp: silentGithub(),
      geminiHttp: async (...args) => {
        gemini += 1;
        return geminiHttp(500)(...args);
      },
      cache,
    });
    assert.equal(gemini, 0);
    assert.equal(view.status, "unavailable");
    if (view.status === "unavailable") {
      assert.equal(view.reason, "error");
      assert.equal(view.errorReason, "gemini_timeout");
    }
  });
});

describe("readCachedBountyIntelligence", () => {
  it("returns the stored row and does not call Gemini or write", async () => {
    let reads = 0;
    const view = await readCachedBountyIntelligence({
      bountyId: BOUNTY_ID,
      db: {} as never,
      read: async () => {
        reads += 1;
        return {
          bountyId: BOUNTY_ID,
          status: "ready",
          repoAbout: "A sample repo",
          languageStack: "TypeScript",
          complexity: "S",
          model: "gemini-test",
          sourceFingerprint: "abc",
          errorReason: null,
          generatedAt: new Date("2026-09-01T00:00:00.000Z"),
          createdAt: new Date("2026-09-01T00:00:00.000Z"),
          updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        };
      },
    });
    assert.equal(reads, 1);
    assert.equal(view.status, "ready");
    if (view.status === "ready") {
      assert.equal(view.complexity, "S");
      assert.equal(view.generatedAt, "2026-09-01T00:00:00.000Z");
    }
    const missing = await readCachedBountyIntelligence({
      bountyId: BOUNTY_ID,
      db: {} as never,
      read: async () => null,
    });
    assert.equal(missing.status, "not_cached");
    assert.equal(missing.cached, false);
  });
});
