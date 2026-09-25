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
  "/api/v1/me/usage",
];

describe("OpenAPI document", () => {
  it("validates as OpenAPI 3.1 and lists every read route", async () => {
    const document = buildOpenApiDocument({ env: {} });
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
    assert.match(json, /escrows\.fund_tx_hash is recorded/);
    assert.match(json, /0\.000000 when there is no verified inflow/);
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
    const operationIds = new Set<string>();
    for (const item of Object.values(document.paths ?? {})) {
      if (!item) continue;
      for (const method of ["get", "post", "put", "patch", "delete"] as const) {
        const operation = item[method];
        if (!operation) continue;
        assert.equal(typeof operation.operationId, "string", operation.operationId);
        assert.equal(operationIds.has(operation.operationId ?? ""), false, operation.operationId);
        operationIds.add(operation.operationId ?? "");
      }
    }
    const fund = document.paths?.["/api/v1/bounties/{id}/fund"]?.post?.responses;
    assert.ok(fund?.["400"]);
    assert.ok(fund?.["401"]);
    assert.ok(fund?.["429"]);
    const topUp = document.paths?.["/api/v1/bounties/{id}/top-up"]?.post?.responses;
    assert.ok(topUp?.["400"]);
    assert.ok(topUp?.["401"]);
    assert.ok(topUp?.["429"]);
    assert.match(JSON.stringify(document.paths?.["/api/v1/bounties/{id}/cancel"]?.post?.responses?.["409"]), /already_cancelled/);
    const usage = document.components?.schemas?.KeyUsage as {
      properties?: {
        perTxCapUsdc?: { pattern?: string };
        dayStart?: { format?: string };
        entries?: { items?: { properties?: { amountUsdc?: { pattern?: string } } } };
      };
    };
    assert.equal(usage.properties?.perTxCapUsdc?.pattern, String.raw`^\d+\.\d{6}$`);
    assert.equal(usage.properties?.entries?.items?.properties?.amountUsdc?.pattern, String.raw`^\d+\.\d{6}$`);
    assert.equal(usage.properties?.dayStart?.format, "date-time");
  });

  it("lists the request host first for PROD and for DEV", () => {
    const prod = buildOpenApiDocument({ host: "githubbounties.xyz", env: {} });
    assert.deepEqual(
      prod.servers?.map((server) => server.url),
      ["https://githubbounties.xyz", "https://dev.githubbounties.xyz"],
    );
    const www = buildOpenApiDocument({ host: "www.githubbounties.xyz", env: {} });
    assert.equal(www.servers?.[0]?.url, "https://githubbounties.xyz");

    const dev = buildOpenApiDocument({
      host: "dev.githubbounties.xyz",
      env: { NEXT_PUBLIC_APP_URL: "https://githubbounties.xyz" },
    });
    assert.deepEqual(
      dev.servers?.map((server) => server.url),
      ["https://dev.githubbounties.xyz", "https://githubbounties.xyz"],
    );
  });

  it("uses the app origin when the host is missing or untrusted", () => {
    const prod = buildOpenApiDocument({
      host: "github-bounties-web-abc.run.app",
      env: { APP_BASE_URL: "https://githubbounties.xyz/api" },
    });
    assert.equal(prod.servers?.[0]?.url, "https://githubbounties.xyz");

    const dev = buildOpenApiDocument({
      host: null,
      env: { NEXT_PUBLIC_APP_URL: "https://dev.githubbounties.xyz" },
    });
    assert.equal(dev.servers?.[0]?.url, "https://dev.githubbounties.xyz");
    assert.equal(dev.servers?.[1]?.url, "https://githubbounties.xyz");
  });
});
