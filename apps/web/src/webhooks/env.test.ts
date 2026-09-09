import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GITHUB_APP_INSTALL_ENV_KEYS,
  githubAppMissingEnvBody,
  missingGitHubAppInstallEnv,
  missingWebhookSecret,
  readGitHubAppPrivateKey,
  webhookMissingSecretBody,
} from "./env";

describe("GitHub App / webhook env", () => {
  it("lists missing webhook secret without reading the value", () => {
    assert.deepEqual(missingWebhookSecret({}), ["GITHUB_WEBHOOK_SECRET"]);
    assert.deepEqual(missingWebhookSecret({ GITHUB_WEBHOOK_SECRET: "  " }), [
      "GITHUB_WEBHOOK_SECRET",
    ]);
    assert.deepEqual(missingWebhookSecret({ GITHUB_WEBHOOK_SECRET: "set" }), []);
  });

  it("lists missing App install vars", () => {
    assert.deepEqual(missingGitHubAppInstallEnv({}), [...GITHUB_APP_INSTALL_ENV_KEYS]);
    assert.deepEqual(
      missingGitHubAppInstallEnv({
        GITHUB_APP_ID: "1",
        GITHUB_APP_SLUG: "slug",
        GITHUB_APP_CLIENT_ID: "cid",
        GITHUB_APP_CLIENT_SECRET: "csec",
        GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nA\\n-----END PRIVATE KEY-----",
      }),
      [],
    );
  });

  it("normalizes escaped PEM newlines and documents missing-secret blockers", () => {
    const pem = readGitHubAppPrivateKey({
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----",
    });
    assert.match(pem, /\nABC\n/);
    assert.equal(webhookMissingSecretBody().error, "missing_github_webhook_secret");
    assert.equal(githubAppMissingEnvBody(["GITHUB_APP_ID"]).error, "missing_github_app_env");
  });
});
