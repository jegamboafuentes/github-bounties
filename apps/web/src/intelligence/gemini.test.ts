import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateBountyIntelligence } from "./gemini";
import type { GeminiHttp } from "./gemini";

describe("Gemini generate", () => {
  it("soft-fails when the key is missing without calling the network", async () => {
    let called = false;
    const http: GeminiHttp = async () => {
      called = true;
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const result = await generateBountyIntelligence({
      prompt: "test",
      env: {},
      http,
    });
    assert.deepEqual(result, { ok: false, error: "missing_key" });
    assert.equal(called, false);
  });

  it("sends the key in x-goog-api-key, never as NEXT_PUBLIC, and parses JSON", async () => {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const http: GeminiHttp = async (url, init) => {
      calls.push({ url, headers: init?.headers });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"repoAbout":"Widgets","languageStack":"TS","complexity":"S"}',
                  },
                ],
              },
            },
          ],
        }),
      };
    };
    const result = await generateBountyIntelligence({
      prompt: "analyze",
      env: { GEMINI_API_KEY: "server-secret", GEMINI_MODEL: "gemini-2.5-flash" },
      http,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.output.complexity, "S");
      assert.equal(result.model, "gemini-2.5-flash");
    }
    assert.equal(calls.length, 1);
    assert.match(calls[0]?.url ?? "", /gemini-2.5-flash:generateContent/);
    assert.equal(calls[0]?.url?.includes("server-secret"), false);
    assert.equal(calls[0]?.headers?.["x-goog-api-key"], "server-secret");
    assert.equal(calls[0]?.headers?.["NEXT_PUBLIC_GEMINI_API_KEY"], undefined);
  });

  it("maps HTTP failures without throwing", async () => {
    const http: GeminiHttp = async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: "rate" }),
    });
    const result = await generateBountyIntelligence({
      prompt: "analyze",
      env: { GEMINI_API_KEY: "k" },
      http,
    });
    assert.deepEqual(result, { ok: false, error: "gemini_http_429" });
  });
});
