import { HF_OAUTH_REDIRECT_PATH } from "./env";

/** Public origin: PUBLIC_BASE_URL, then AUTH_URL, then local dev. */
export function hfPublicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = (env.PUBLIC_BASE_URL || env.AUTH_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return "http://localhost:3000";
}

/** Redirect URI sent to Hugging Face. Must match the OAuth app registration exactly. */
export function hfCallbackUrl(origin = hfPublicOrigin()): string {
  return `${origin.replace(/\/$/, "")}${HF_OAUTH_REDIRECT_PATH}`;
}
