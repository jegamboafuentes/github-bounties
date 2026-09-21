import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_GEMINI_MODEL,
  hasGeminiApiKey,
  readGeminiApiKey,
  readGeminiModel,
} from "./env";

describe("Gemini env", () => {
  it("reads GEMINI_API_KEY from server env and ignores NEXT_PUBLIC_*", () => {
    assert.equal(readGeminiApiKey({}), "");
    assert.equal(hasGeminiApiKey({}), false);
    assert.equal(readGeminiApiKey({ GEMINI_API_KEY: "  " }), "");
    assert.equal(readGeminiApiKey({ GEMINI_API_KEY: "server-key" }), "server-key");
    assert.equal(
      readGeminiApiKey({ NEXT_PUBLIC_GEMINI_API_KEY: "leaked-to-client" }),
      "",
    );
    assert.equal(
      readGeminiApiKey({
        NEXT_PUBLIC_GEMINI_API_KEY: "leaked-to-client",
        GEMINI_API_KEY: "server-key",
      }),
      "server-key",
    );
  });

  it("defaults the model and never uses a NEXT_PUBLIC model name", () => {
    assert.equal(readGeminiModel({}), DEFAULT_GEMINI_MODEL);
    assert.equal(readGeminiModel({ GEMINI_MODEL: "gemini-2.0-flash" }), "gemini-2.0-flash");
    assert.equal(
      readGeminiModel({ NEXT_PUBLIC_GEMINI_MODEL: "should-not-win" }),
      DEFAULT_GEMINI_MODEL,
    );
  });
});
