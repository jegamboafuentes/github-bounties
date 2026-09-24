import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ZodError, z } from "zod";
import { apiErrorResponse, publicApiErrorBody, zodErrorDetails, PUBLIC_API_ERROR_CODES } from "./errors";
import { handlePublicRead } from "./http";

describe("public API error shape", () => {
  it("uses one envelope for every V4-1 code", async () => {
    const cases = [
      ["validation_failed", 400],
      ["not_found", 404],
      ["rate_limited", 429],
      ["internal", 500],
    ] as const;
    assert.deepEqual(
      cases.map(([code]) => code),
      [...PUBLIC_API_ERROR_CODES],
    );
    for (const [code, status] of cases) {
      const details = code === "validation_failed" ? [{ path: "limit", message: "Too big" }] : null;
      const response = apiErrorResponse(code, `${code} message`, details);
      assert.equal(response.status, status);
      const body = await response.json();
      assert.deepEqual(Object.keys(body).sort(), ["error"]);
      assert.equal(body.error.code, code);
      assert.equal(body.error.message, `${code} message`);
      assert.deepEqual(body.error.details, details);
      assert.deepEqual(body, publicApiErrorBody(code, `${code} message`, details));
    }
  });

  it("puts zod issues on details.path", () => {
    const parsed = z.object({ limit: z.number().int().max(100) }).safeParse({ limit: 101 });
    assert.equal(parsed.success, false);
    if (parsed.success) return;
    assert.ok(parsed.error instanceof ZodError);
    const details = zodErrorDetails(parsed.error);
    assert.equal(details[0]?.path, "limit");
    assert.match(details[0]?.message ?? "", /100/);
  });

  it("returns the envelope from the read handler, including rate limit headers", async () => {
    const response = await handlePublicRead(
      new Request("https://dev.githubbounties.xyz/api/v1/stats", {
        headers: { "x-forwarded-for": "203.0.113.10" },
      }),
      async () => Response.json({ ok: true }),
      { cors: true },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("ratelimit-limit"), "60");
    assert.equal(response.headers.get("ratelimit-remaining"), "59");
    const body = await response.json();
    assert.equal(body.ok, true);
  });
});
