/**
 * GitHub App + webhook env (V1-3).
 *
 * Secret Manager keys on experiment-jegf / 42206083192:
 *   GITHUB_WEBHOOK_SECRET, GITHUB_APP_PRIVATE_KEY,
 *   GITHUB_APP_ID, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET
 * Values stay out of git. Placeholders only in .env.example.
 */

import { missingEnv, type EnvMap } from "../auth/env";

export const GITHUB_WEBHOOK_SECRET_KEY = "GITHUB_WEBHOOK_SECRET" as const;

export const GITHUB_APP_INSTALL_ENV_KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_SLUG",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
] as const;

export const GITHUB_APP_API_ENV_KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
] as const;

export function missingWebhookSecret(env: EnvMap = process.env): string[] {
  return missingEnv([GITHUB_WEBHOOK_SECRET_KEY], env);
}

export function missingGitHubAppInstallEnv(env: EnvMap = process.env): string[] {
  return missingEnv(GITHUB_APP_INSTALL_ENV_KEYS, env);
}

export function missingGitHubAppApiEnv(env: EnvMap = process.env): string[] {
  return missingEnv(GITHUB_APP_API_ENV_KEYS, env);
}

export function readWebhookSecret(env: EnvMap = process.env): string {
  return env.GITHUB_WEBHOOK_SECRET?.trim() ?? "";
}

export function readGitHubAppId(env: EnvMap = process.env): string {
  return env.GITHUB_APP_ID?.trim() ?? "";
}

export function readGitHubAppSlug(env: EnvMap = process.env): string {
  return env.GITHUB_APP_SLUG?.trim() ?? "";
}

export function readGitHubAppOAuth(env: EnvMap = process.env): {
  clientId: string;
  clientSecret: string;
} {
  return {
    clientId: env.GITHUB_APP_CLIENT_ID?.trim() ?? "",
    clientSecret: env.GITHUB_APP_CLIENT_SECRET?.trim() ?? "",
  };
}

/**
 * PEM contents. Accepts literal newlines or `\n` escaped single-line env values.
 * Never log the return value.
 */
export function readGitHubAppPrivateKey(env: EnvMap = process.env): string {
  const raw = env.GITHUB_APP_PRIVATE_KEY?.trim() ?? "";
  if (!raw) return "";
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function webhookMissingSecretBody() {
  return {
    ok: false,
    error: "missing_github_webhook_secret",
    missing: [GITHUB_WEBHOOK_SECRET_KEY],
    message:
      "GITHUB_WEBHOOK_SECRET is unset. Signature verification is fail-closed. Create a staging GitHub App and set the webhook secret (Secret Manager / env). See docs/github-app.md and docs/webhooks.md. Never commit the value.",
  };
}

export function githubAppMissingEnvBody(missing: string[]) {
  return {
    ok: false,
    error: "missing_github_app_env",
    missing,
    message:
      "GitHub App install is blocked until App id/slug/client/private key are set (empty placeholders in .env.example). See docs/github-app.md. Never commit real secrets.",
  };
}

export function githubAppMissingEnvResponse(missing: string[]): Response {
  return Response.json(githubAppMissingEnvBody(missing), {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}

export function webhookMissingSecretResponse(): Response {
  return Response.json(webhookMissingSecretBody(), {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}
