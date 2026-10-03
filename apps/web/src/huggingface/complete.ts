import type { Database } from "../db/client";
import { getRuntimeDb } from "../db/runtime";
import { readCookie, HF_CONNECT_COOKIE } from "./cookie";
import { hfNotConfiguredBody, missingHfOAuthEnv } from "./env";
import { exchangeHfAuthorizationCode, type HfHttp } from "./oauth";
import { HfAccountTakenError, linkHuggingFaceAccount } from "./persist";
import { pkceHashesMatch, verifyHfConnectState } from "./state";
import { hfCallbackUrl, hfPublicOrigin } from "./urls";

export type HfCompleteResult =
  | { ok: true; hfUsername: string }
  | { ok: false; error: string; message: string };

export async function completeHuggingFaceConnect(
  input: {
    userId: string;
    code?: string | null;
    state?: string | null;
    oauthError?: string | null;
    cookieHeader?: string | null;
    origin?: string;
    now?: number;
  },
  opts: { db?: Database; http?: HfHttp; env?: NodeJS.ProcessEnv } = {},
): Promise<HfCompleteResult> {
  const missing = missingHfOAuthEnv(opts.env);
  if (missing.length > 0) {
    const body = hfNotConfiguredBody();
    return { ok: false, error: body.error, message: body.message };
  }
  if (input.oauthError) {
    return {
      ok: false,
      error: "oauth_denied",
      message: "Hugging Face denied the connect request.",
    };
  }

  const state = verifyHfConnectState(input.state, undefined, input.now);
  if (!state) {
    return {
      ok: false,
      error: "invalid_state",
      message: "Hugging Face connect expired or is invalid. Start again from Settings.",
    };
  }
  if (state.userId !== input.userId) {
    return {
      ok: false,
      error: "state_user_mismatch",
      message: "This Hugging Face connect was started by a different signed-in user.",
    };
  }
  const verifier = readCookie(input.cookieHeader, HF_CONNECT_COOKIE);
  if (!verifier || !pkceHashesMatch(verifier, state.pkceHash)) {
    return {
      ok: false,
      error: "invalid_state",
      message: "Hugging Face connect expired or is invalid. Start again from Settings.",
    };
  }
  const code = input.code?.trim() ?? "";
  if (!code) {
    return {
      ok: false,
      error: "missing_code",
      message: "Hugging Face did not return an authorization code. Start again from Settings.",
    };
  }

  const env = opts.env ?? process.env;
  const origin = input.origin ?? hfPublicOrigin(env);
  try {
    const identity = await exchangeHfAuthorizationCode({
      code,
      redirectUri: hfCallbackUrl(origin),
      codeVerifier: verifier,
      env,
      http: opts.http,
    });
    const db = opts.db ?? getRuntimeDb();
    const row = await linkHuggingFaceAccount(input.userId, identity, db);
    return { ok: true, hfUsername: row.hfUsername };
  } catch (err) {
    if (err instanceof HfAccountTakenError) {
      return { ok: false, error: err.code, message: err.message };
    }
    const message = err instanceof Error ? err.message : "Hugging Face connect failed";
    return { ok: false, error: "oauth_failed", message };
  }
}
