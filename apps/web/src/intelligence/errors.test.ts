import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyIntelligenceFailure,
  intelligenceUnavailableCopy,
  isUndefinedTableError,
  logIntelligenceEvent,
  sanitizeIntelligenceErrorReason,
} from "./errors";

describe("intelligence error codes", () => {
  it("keeps allowlisted reasons and never passes through raw text", () => {
    assert.equal(sanitizeIntelligenceErrorReason("missing_table"), "missing_table");
    assert.equal(sanitizeIntelligenceErrorReason("gemini_http_404"), "gemini_http_404");
    assert.equal(sanitizeIntelligenceErrorReason("gemini_parse"), "gemini_parse");
    assert.equal(sanitizeIntelligenceErrorReason("gemini_timeout"), "gemini_timeout");
    assert.equal(
      sanitizeIntelligenceErrorReason('relation "bounty_intelligence" does not exist'),
      "error",
    );
    assert.equal(sanitizeIntelligenceErrorReason("sk-live-secret"), "error");
    assert.equal(sanitizeIntelligenceErrorReason(""), undefined);
  });

  it("classifies a missing bounty_intelligence table", () => {
    const err = Object.assign(new Error('relation "bounty_intelligence" does not exist'), {
      code: "42P01",
    });
    assert.equal(isUndefinedTableError(err), true);
    assert.deepEqual(classifyIntelligenceFailure(err), {
      code: "missing_table",
      pgCode: "42P01",
    });
    assert.equal(
      classifyIntelligenceFailure(new Error("fetch failed")).code,
      "error",
    );
  });

  it("surfaces missing_key vs error on the card copy", () => {
    assert.deepEqual(intelligenceUnavailableCopy({ reason: "missing_key" }), {
      headline: "Intelligence unavailable",
      detail: "missing_key",
    });
    assert.deepEqual(
      intelligenceUnavailableCopy({ reason: "error", errorReason: "missing_table" }),
      { headline: "Intelligence unavailable", detail: "error · missing_table" },
    );
    assert.deepEqual(
      intelligenceUnavailableCopy({ reason: "error", errorReason: "gemini_http_429" }),
      { headline: "Intelligence unavailable", detail: "error · gemini_http_429" },
    );
  });

  it("logs JSON without leaking GEMINI_API_KEY", () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: unknown) => {
      lines.push(String(line));
    };
    try {
      logIntelligenceEvent("bounty_intelligence_cache_write_failed", {
        bountyId: "b-1",
        error: "missing_table",
        pgCode: "42P01",
        GEMINI_API_KEY: "should-not-log",
        apiKey: "also-no",
      });
    } finally {
      console.error = original;
    }
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    assert.equal(parsed.event, "bounty_intelligence_cache_write_failed");
    assert.equal(parsed.bountyId, "b-1");
    assert.equal(parsed.error, "missing_table");
    assert.equal(parsed.GEMINI_API_KEY, undefined);
    assert.equal(parsed.apiKey, undefined);
    assert.equal(JSON.stringify(parsed).includes("should-not-log"), false);
  });
});
