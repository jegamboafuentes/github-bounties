import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { developersToMcpRedirect, isLegacyDevelopersPath } from "./developers-redirect";

describe("permanent /developers redirect", () => {
  it("sends /developers and every subpath to /mcp with 308", () => {
    const paths = ["/developers", "/developers/", "/developers/tools", "/developers/a/b", "/developers/a/b/"];
    for (const path of paths) {
      assert.equal(isLegacyDevelopersPath(path), true, path);
      const response = developersToMcpRedirect(new URL(`http://evil.example${path}?next=https://phish.example`));
      assert.ok(response, path);
      assert.equal(response.status, 308, path);
      assert.equal(response.headers.get("location"), "/mcp", path);
      assert.doesNotMatch(response.headers.get("location") ?? "", /evil|phish|developers/);
    }
  });

  it("does not redirect other paths", () => {
    for (const path of ["/developer", "/mcp", "/developers-old", "/", "/about"]) {
      assert.equal(isLegacyDevelopersPath(path), false, path);
      assert.equal(developersToMcpRedirect(new URL(`https://githubbounties.xyz${path}`)), null, path);
    }
  });
});
