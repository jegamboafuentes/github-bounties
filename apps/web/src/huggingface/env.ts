/**
 * Hugging Face connect (OIDC). Not product login.
 *
 * Secret Manager keys, optional: HF_OAUTH_CLIENT_ID, HF_OAUTH_CLIENT_SECRET.
 * Values stay out of git. Placeholders only in .env.example.
 * Endpoints match the Auth.js `huggingface` provider (issuer https://huggingface.co)
 * without registering that provider as a sign-in method.
 */

import { missingEnv, type EnvMap } from "../auth/env";

export const HF_OAUTH_CLIENT_ID_KEY = "HF_OAUTH_CLIENT_ID" as const;
export const HF_OAUTH_CLIENT_SECRET_KEY = "HF_OAUTH_CLIENT_SECRET" as const;

export const HF_OAUTH_ENV_KEYS = [HF_OAUTH_CLIENT_ID_KEY, HF_OAUTH_CLIENT_SECRET_KEY] as const;

/** Auth.js huggingface default is wider. This connect flow asks only for these. */
export const HF_OAUTH_SCOPE = "openid profile";

export const HF_ISSUER = "https://huggingface.co";
export const HF_AUTHORIZE_URL = `${HF_ISSUER}/oauth/authorize`;
export const HF_TOKEN_URL = `${HF_ISSUER}/oauth/token`;
export const HF_USERINFO_URL = `${HF_ISSUER}/oauth/userinfo`;

export const HF_OAUTH_REDIRECT_PATH = "/huggingface/callback";

/** Exact redirect URIs to register on the Hugging Face OAuth app. */
export const HF_DEV_REDIRECT_URI = `https://dev.githubbounties.xyz${HF_OAUTH_REDIRECT_PATH}`;
export const HF_PROD_REDIRECT_URI = `https://githubbounties.xyz${HF_OAUTH_REDIRECT_PATH}`;
export const HF_LOCAL_REDIRECT_URI = `http://localhost:3000${HF_OAUTH_REDIRECT_PATH}`;

export function missingHfOAuthEnv(env: EnvMap = process.env): string[] {
  return missingEnv(HF_OAUTH_ENV_KEYS, env);
}

export function hfOAuthConfigured(env: EnvMap = process.env): boolean {
  return missingHfOAuthEnv(env).length === 0;
}

export function readHfOAuthEnv(env: EnvMap = process.env): {
  clientId: string;
  clientSecret: string;
} {
  return {
    clientId: env.HF_OAUTH_CLIENT_ID?.trim() ?? "",
    clientSecret: env.HF_OAUTH_CLIENT_SECRET?.trim() ?? "",
  };
}

/** Signed-in caller, connect not set up. 404 so a missing optional secret is not a 5xx. */
export function hfNotConfiguredBody() {
  return {
    ok: false as const,
    error: "hf_not_configured" as const,
    message: "Hugging Face connect is not available. Product login stays Google.",
  };
}

export function hfNotConfiguredResponse(): Response {
  return Response.json(hfNotConfiguredBody(), {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}
