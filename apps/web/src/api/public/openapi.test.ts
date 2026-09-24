import assert from "node:assert/strict";
import { describe, it } from "node:test";
import SwaggerParser from "@apidevtools/swagger-parser";
import { PUBLIC_API_DESCRIPTION, buildOpenApiDocument } from "./schemas";

const READ_ONLY = [
  "/api/v1/bounties/{id}",
  "/api/v1/bounties/{id}/funders",
  "/api/v1/bounties/{id}/intelligence",
  "/api/v1/stats",
];

const WRITE = [
  "/api/v1/bounties",
  "/api/v1/bounties/{id}/work-signal",
  "/api/v1/bounties/{id}/cancel",
  "/api/v1/bounties/{id}/fund",
  "/api/v1/bounties/{id}/top-up",
  "/api/v1/me",
  "/api/v1/me/bounties",
];

describe("OpenAPI document", () => {
  it("validates as OpenAPI 3.1 and lists every read route", async () => {
    const document = buildOpenApiDocument();
    await SwaggerParser.validate(document);
    assert.equal(document.openapi, "3.1.0");
    assert.equal(document.info.title, "GitHub Bounties API");
    assert.match(document.info.description ?? "", /60 requests per minute/);
    assert.match(PUBLIC_API_DESCRIPTION, /Cloud Run instance/);
    assert.deepEqual(
      document.servers?.map((server) => server.url),
      ["https://dev.githubbounties.xyz", "https://githubbounties.xyz"],
    );
    assert.deepEqual(Object.keys(document.paths ?? {}).sort(), [...READ_ONLY, ...WRITE].sort());
    for (const path of READ_ONLY) {
      const item = document.paths?.[path];
      assert.ok(item?.get, path);
      assert.equal(item.post, undefined, path);
      assert.equal(item.delete, undefined, path);
    }
    assert.ok(document.paths?.["/api/v1/bounties"]?.post);
    assert.ok(document.paths?.["/api/v1/bounties/{id}/fund"]?.post);
    assert.ok(document.paths?.["/api/v1/bounties/{id}/top-up"]?.post);
    assert.ok(document.paths?.["/api/v1/bounties/{id}/cancel"]?.post);
    assert.ok(document.paths?.["/api/v1/bounties/{id}/work-signal"]?.delete);
    assert.ok(document.paths?.["/api/v1/me"]?.get);
    const security = document.components?.securitySchemes as { bearerAuth?: { scheme?: string } } | undefined;
    assert.equal(security?.bearerAuth?.scheme, "bearer");
    const listParams = document.paths?.["/api/v1/bounties"]?.get?.parameters ?? [];
    const names = listParams.map((param) => ("name" in param ? param.name : ""));
    for (const name of ["repo", "status", "complexity", "language", "has_intel", "sort", "limit", "cursor"]) {
      assert.ok(names.includes(name), name);
    }
    const json = JSON.stringify(document);
    assert.match(json, /Sum of confirmed bounty contributions/);
    assert.match(json, /0\.000000 when none are confirmed/);
    assert.match(json, /newest contribution first/);
    assert.match(json, /GET, OPTIONS/);
    assert.match(json, /method_not_allowed/);
    for (const path of READ_ONLY) {
      assert.ok(document.paths?.[path]?.get?.responses?.["405"], `${path} 405`);
    }
    assert.match(json, /bearer/);
    assert.match(json, /payment_required/);
    assert.match(json, /spend_cap_exceeded/);
    assert.match(json, /idempotency_conflict/);
  });
});
