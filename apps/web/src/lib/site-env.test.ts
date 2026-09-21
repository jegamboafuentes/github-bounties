import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDevSite } from "./site-env";

describe("isDevSite", () => {
  it("shows the DEV pill on the DEV custom domain", () => {
    assert.equal(isDevSite({ env: { AUTH_URL: "https://dev.githubbounties.xyz" } }), true);
    assert.equal(
      isDevSite({ env: { PUBLIC_BASE_URL: "https://dev.githubbounties.xyz/" } }),
      true,
    );
    assert.equal(isDevSite({ host: "dev.githubbounties.xyz", env: {} }), true);
    assert.equal(isDevSite({ env: { APP_ENV: "dev" } }), true);
    assert.equal(isDevSite({ env: { K_SERVICE: "github-bounties-web" } }), true);
  });

  it("never shows the pill on PROD apex or prod Cloud Run", () => {
    assert.equal(isDevSite({ env: { AUTH_URL: "https://githubbounties.xyz" } }), false);
    assert.equal(
      isDevSite({ env: { PUBLIC_BASE_URL: "https://www.githubbounties.xyz" } }),
      false,
    );
    assert.equal(isDevSite({ host: "githubbounties.xyz", env: {} }), false);
    assert.equal(
      isDevSite({
        host: "dev.githubbounties.xyz",
        env: { K_SERVICE: "github-bounties-web-prod" },
      }),
      false,
    );
    assert.equal(
      isDevSite({
        env: {
          AUTH_URL: "https://dev.githubbounties.xyz",
          PUBLIC_BASE_URL: "https://githubbounties.xyz",
        },
      }),
      false,
    );
    assert.equal(isDevSite({ env: { APP_ENV: "production" } }), false);
    assert.equal(isDevSite({ env: {} }), false);
    assert.equal(isDevSite({ host: "localhost:3000", env: {} }), false);
  });
});
