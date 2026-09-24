import assert from "node:assert/strict";
import { describe, it } from "node:test";
import SwaggerParser from "@apidevtools/swagger-parser";
import { PUBLIC_API_DESCRIPTION, buildOpenApiDocument } from "./schemas";

const ROUTES = [
  "/api/v1/bounties",
  "/api/v1/bounties/{id}",
  "/api/v1/bounties/{id}/funders",
  "/api/v1/bounties/{id}/intelligence",
  "/api/v1/stats",
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
    assert.deepEqual(Object.keys(document.paths ?? {}).sort(), [...ROUTES].sort());
    for (const path of ROUTES) {
      const item = document.paths?.[path];
      assert.ok(item?.get, path);
      assert.equal(item.put, undefined);
      assert.equal(item.post, undefined);
      assert.equal(item.delete, undefined);
    }
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
    for (const path of ROUTES) {
      assert.ok(document.paths?.[path]?.get?.responses?.["405"], `${path} 405`);
    }
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
