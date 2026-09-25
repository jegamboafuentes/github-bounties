import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ZodError, z } from "zod";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_CORS_EXPOSE_HEADERS, publicCorsPreflight, publicSurfaceDispatch } from "./cors";
import { apiErrorResponse, publicApiErrorBody, zodErrorDetails, PUBLIC_API_ERROR_CODES } from "./errors";
import { handlePublicRead } from "./http";
import { methodNotAllowed, PUBLIC_READ_ALLOW } from "./methods";

describe("public API error shape", () => {
  it("uses one envelope for every V4-1 code", async () => {
    const cases = [
      ["validation_failed", 400],
      ["not_found", 404],
      ["method_not_allowed", 405],
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

  it("405 keeps the JSON error envelope and sets Allow: GET, OPTIONS", async () => {
    const response = methodNotAllowed();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), PUBLIC_READ_ALLOW);
    assert.equal(PUBLIC_READ_ALLOW, "GET, OPTIONS");
    const body = await response.json();
    assert.deepEqual(body, publicApiErrorBody("method_not_allowed", "Only GET and OPTIONS are allowed.", null));
    assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
    assert.equal(response.headers.get("access-control-expose-headers"), API_CORS_EXPOSE_HEADERS);
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /Authorization/);
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /Mcp-Session-Id/);
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /PAYMENT-SIGNATURE/);
  });

  it("answers public API OPTIONS as CORS preflight and skips the session gate", () => {
    assert.equal(publicSurfaceDispatch("/mcp", "OPTIONS"), "preflight");
    assert.equal(publicSurfaceDispatch("/api/v1/me/usage", "OPTIONS"), "preflight");
    assert.equal(publicSurfaceDispatch("/api/v1/bounties", "GET"), "bypass");
    assert.equal(publicSurfaceDispatch("/api/docs", "GET"), "bypass");
    assert.equal(publicSurfaceDispatch("/settings", "GET"), "session");
    const preflight = publicCorsPreflight();
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /OPTIONS/);
    assert.equal(preflight.headers.get("access-control-expose-headers"), API_CORS_EXPOSE_HEADERS);
    const proxy = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../proxy.ts"), "utf8");
    const matcher = proxy.slice(proxy.indexOf("matcher:"));
    assert.match(matcher, /\/settings/);
    assert.doesNotMatch(matcher, /\/api\/v1/);
    assert.doesNotMatch(matcher, /\/api\/docs/);
    assert.doesNotMatch(matcher, /\/mcp/);
  });

  it("read-only /api/v1 routes still answer writes with methodNotAllowed", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../app/api/v1");
    const routes = [
      "bounties/[id]/route.ts",
      "bounties/[id]/funders/route.ts",
      "bounties/[id]/intelligence/route.ts",
      "stats/route.ts",
      "openapi.json/route.ts",
    ];
    for (const route of routes) {
      const source = readFileSync(join(root, route), "utf8");
      assert.match(source, /methodNotAllowed/, route);
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        assert.match(source, new RegExp(`export function ${method}\\(`), `${route} ${method}`);
      }
    }
    const writes = readFileSync(join(root, "bounties/route.ts"), "utf8");
    assert.match(writes, /handleV1Action/);
    assert.match(writes, /methodNotAllowed\(WRITE_ALLOW\)/);
  });

  it("POST /api/docs is 405 with Allow and the JSON error body", async () => {
    const route = await import("../../app/api/docs/route.ts");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const response = route[method]();
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.get("allow"), "GET, OPTIONS");
      const body = await response.json();
      assert.equal(body.error.code, "method_not_allowed");
      assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
    }
    assert.equal(route.OPTIONS().status, 204);
  });

  it("profile routes allow PATCH and linked accounts stay read-only", async () => {
    const profile = await import("../../app/api/v1/me/profile/route.ts");
    const prefs = await import("../../app/api/v1/me/notification-preferences/route.ts");
    const linked = await import("../../app/api/v1/me/linked-accounts/route.ts");
    for (const route of [profile, prefs]) {
      for (const method of ["POST", "PUT", "DELETE"] as const) {
        const response = route[method]();
        assert.equal(response.status, 405, method);
        assert.equal(response.headers.get("allow"), "GET, PATCH, OPTIONS");
        const body = await response.json();
        assert.equal(body.error.code, "method_not_allowed");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const response = linked[method]();
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.get("allow"), "GET, OPTIONS");
    }
  });
});
