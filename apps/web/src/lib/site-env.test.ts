import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDevSite, LOCAL_SITE_ORIGIN, readPublicSiteOrigin } from "./site-env";

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

describe("readPublicSiteOrigin", () => {
  it("prefers PUBLIC_BASE_URL then AUTH_URL and drops any path", () => {
    assert.equal(
      readPublicSiteOrigin({
        PUBLIC_BASE_URL: "https://dev.githubbounties.xyz/path/",
        AUTH_URL: "https://githubbounties.xyz",
      }),
      "https://dev.githubbounties.xyz",
    );
    assert.equal(
      readPublicSiteOrigin({ AUTH_URL: "https://githubbounties.xyz/" }),
      "https://githubbounties.xyz",
    );
    assert.equal(
      readPublicSiteOrigin({ PUBLIC_BASE_URL: "githubbounties.xyz" }),
      "https://githubbounties.xyz",
    );
  });

  it("uses the request host when env is unset so DEV and PROD still absolute", () => {
    assert.equal(
      readPublicSiteOrigin({}, { host: "dev.githubbounties.xyz", proto: "https" }),
      "https://dev.githubbounties.xyz",
    );
    assert.equal(
      readPublicSiteOrigin({}, { host: "githubbounties.xyz", proto: "https" }),
      "https://githubbounties.xyz",
    );
    assert.equal(
      readPublicSiteOrigin(
        {},
        { host: "dev.githubbounties.xyz, githubbounties.xyz", proto: "https,http" },
      ),
      "https://dev.githubbounties.xyz",
    );
  });

  it("does not let a request host override a configured origin", () => {
    assert.equal(
      readPublicSiteOrigin(
        { PUBLIC_BASE_URL: "https://githubbounties.xyz" },
        { host: "dev.githubbounties.xyz", proto: "https" },
      ),
      "https://githubbounties.xyz",
    );
  });

  it("falls back to localhost only when nothing public is available", () => {
    assert.equal(readPublicSiteOrigin({}), LOCAL_SITE_ORIGIN);
    assert.equal(
      readPublicSiteOrigin({}, { host: "localhost:3000", proto: "http" }),
      LOCAL_SITE_ORIGIN,
    );
  });
});
