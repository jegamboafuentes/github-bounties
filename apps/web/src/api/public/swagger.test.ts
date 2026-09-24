import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readSwaggerAsset, swaggerDocsHtml, swaggerUiDistDir } from "./swagger";

describe("swagger UI assets", () => {
  it("resolves swagger-ui-dist on disk and serves the bundle", async () => {
    const dir = swaggerUiDistDir();
    assert.match(dir, /swagger-ui-dist$/);
    const js = await readSwaggerAsset("swagger-ui-bundle.js");
    const css = await readSwaggerAsset("swagger-ui.css");
    assert.ok(js);
    assert.ok(css);
    assert.equal(js.contentType, "text/javascript; charset=utf-8");
    assert.equal(css.contentType, "text/css; charset=utf-8");
    assert.ok(js.body.byteLength > 1000);
    assert.ok(css.body.byteLength > 100);
  });

  it("refuses paths outside the asset allowlist", async () => {
    assert.equal(await readSwaggerAsset("../package.json"), null);
    assert.equal(await readSwaggerAsset("swagger-ui-es-bundle.js"), null);
  });

  it("points the docs page at same-origin assets and the OpenAPI document", () => {
    const html = swaggerDocsHtml();
    assert.match(html, /href="\/api\/docs\/assets\/swagger-ui\.css"/);
    assert.match(html, /src="\/api\/docs\/assets\/swagger-ui-bundle\.js"/);
    assert.match(html, /url: "\/api\/v1\/openapi\.json"/);
  });
});
