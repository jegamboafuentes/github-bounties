/**
 * Gemini env (V3-0 bounty intelligence). Server-side only.
 *
 * Secret Manager key GEMINI_API_KEY on experiment-jegf. Never NEXT_PUBLIC_*.
 * Missing key is a soft degrade — do not throw from page loaders.
 */

import type { EnvMap } from "../auth/env";

export const GEMINI_API_KEY_ENV = "GEMINI_API_KEY" as const;
export const GEMINI_MODEL_ENV = "GEMINI_MODEL" as const;
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export function readGeminiApiKey(env: EnvMap = process.env): string {
  return env[GEMINI_API_KEY_ENV]?.trim() ?? "";
}

export function hasGeminiApiKey(env: EnvMap = process.env): boolean {
  return Boolean(readGeminiApiKey(env));
}

export function readGeminiModel(env: EnvMap = process.env): string {
  return env[GEMINI_MODEL_ENV]?.trim() || DEFAULT_GEMINI_MODEL;
}
