import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GOOGLE_SIGNIN_ENV_KEYS,
  LOGIN_ENV_KEYS,
  hasSessionSecret,
  missingGoogleSignInEnv,
  missingLoginEnv,
  readGoogleOAuthEnv,
  resolveAuthSecret,
} from "./env";

describe("auth env", () => {
  it("lists missing Google Sign-In vars without reading secret values", () => {
    const empty = missingGoogleSignInEnv({});
    assert.deepEqual(empty, [...GOOGLE_SIGNIN_ENV_KEYS]);

    const partial = missingGoogleSignInEnv({
      AUTH_SECRET: "x",
      GOOGLE_OAUTH_CLIENT_ID: "  ",
    });
    assert.deepEqual(partial, ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]);
  });

  it("requires DATABASE_URL to complete login (persist google_sub)", () => {
    const missing = missingLoginEnv({
      AUTH_SECRET: "x",
      GOOGLE_OAUTH_CLIENT_ID: "id",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
    });
    assert.deepEqual(missing, ["DATABASE_URL"]);
    assert.ok(LOGIN_ENV_KEYS.includes("DATABASE_URL"));
  });

  it("treats AUTH_SECRET as the session gate", () => {
    assert.equal(hasSessionSecret({}), false);
    assert.equal(hasSessionSecret({ AUTH_SECRET: "  " }), false);
    assert.equal(hasSessionSecret({ AUTH_SECRET: "set" }), true);
  });

  it("reads Google client fields and falls back for AUTH_SECRET without leaking real values", () => {
    const google = readGoogleOAuthEnv({
      GOOGLE_OAUTH_CLIENT_ID: " client ",
      GOOGLE_OAUTH_CLIENT_SECRET: "sek",
    });
    assert.deepEqual(google, { clientId: "client", clientSecret: "sek" });
    assert.equal(resolveAuthSecret({}), "dev-only-insecure-auth-secret");
    assert.equal(resolveAuthSecret({ AUTH_SECRET: "from-env" }), "from-env");
  });
});
