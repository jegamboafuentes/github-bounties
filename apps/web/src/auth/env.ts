/**
 * Google Sign-In env (V1-2).
 *
 * Product identity is Google. Secret Manager keys on experiment-jegf / 42206083192:
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, AUTH_SECRET
 * Values stay out of git. Placeholders only in .env.example.
 */

export const GOOGLE_SIGNIN_ENV_KEYS = [
  "AUTH_SECRET",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
] as const;

export const LOGIN_ENV_KEYS = [...GOOGLE_SIGNIN_ENV_KEYS, "DATABASE_URL"] as const;

export type EnvMap = Record<string, string | undefined>;

export function missingEnv(keys: readonly string[], env: EnvMap = process.env): string[] {
  return keys.filter((key) => !env[key]?.trim());
}

/** Env required to start a Google OAuth sign-in. */
export function missingGoogleSignInEnv(env: EnvMap = process.env): string[] {
  return missingEnv(GOOGLE_SIGNIN_ENV_KEYS, env);
}

/** Env required to complete login (OAuth + persist users.google_sub). */
export function missingLoginEnv(env: EnvMap = process.env): string[] {
  return missingEnv(LOGIN_ENV_KEYS, env);
}

export function hasSessionSecret(env: EnvMap = process.env): boolean {
  return Boolean(env.AUTH_SECRET?.trim());
}

export function readGoogleOAuthEnv(env: EnvMap = process.env): {
  clientId: string;
  clientSecret: string;
} {
  return {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "",
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "",
  };
}

/**
 * Cookie-signing secret for Auth.js.
 * Production must set AUTH_SECRET (Secret Manager). A local fallback keeps
 * `next build` / `/api/health` alive when the var is unset; sign-in stays blocked.
 */
export function resolveAuthSecret(env: EnvMap = process.env): string {
  return env.AUTH_SECRET?.trim() || "dev-only-insecure-auth-secret";
}
