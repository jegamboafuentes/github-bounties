import type { Database } from "../db/client";
import { getRuntimeDb } from "../db/runtime";
import { clearHfConnectCookieHeader, hfConnectCookieHeader } from "./cookie";
import { completeHuggingFaceConnect } from "./complete";
import { hfNotConfiguredResponse, hfOAuthConfigured } from "./env";
import type { HfHttp } from "./oauth";
import { huggingfaceAuthorizeUrl } from "./oauth";
import { createPkcePair, pkceHash, signHfConnectState } from "./state";
import { DISCONNECT_HF_NOTICE, unlinkHuggingFaceForUser } from "./unlink";
import { hfCallbackUrl, hfPublicOrigin } from "./urls";

function settingsNotice(message: string): string {
  return `/settings?notice=${encodeURIComponent(message)}`;
}

function unauthorized(): Response {
  return Response.json(
    { ok: false, error: "unauthorized" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/** Start connect. 401 without a session, then 404 when OAuth env is missing. */
export function startHuggingFaceConnect(input: {
  userId: string | null;
  env?: NodeJS.ProcessEnv;
  now?: number;
}): Response {
  if (!input.userId) return unauthorized();
  const env = input.env ?? process.env;
  if (!hfOAuthConfigured(env)) return hfNotConfiguredResponse();
  const { verifier, challenge } = createPkcePair();
  const state = signHfConnectState(
    { userId: input.userId, pkceHash: pkceHash(verifier), now: input.now },
    undefined,
  );
  const location = huggingfaceAuthorizeUrl({
    state,
    redirectUri: hfCallbackUrl(hfPublicOrigin(env)),
    codeChallenge: challenge,
    env,
  });
  return redirect(location, [hfConnectCookieHeader(verifier, env.NODE_ENV)]);
}

/** Browser return from Hugging Face. 401 without a session, then 404 when OAuth env is missing. */
export async function finishHuggingFaceConnect(input: {
  userId: string | null;
  code?: string | null;
  state?: string | null;
  oauthError?: string | null;
  cookieHeader?: string | null;
  env?: NodeJS.ProcessEnv;
  http?: HfHttp;
  db?: Database;
  now?: number;
}): Promise<Response> {
  if (!input.userId) return unauthorized();
  const env = input.env ?? process.env;
  if (!hfOAuthConfigured(env)) return hfNotConfiguredResponse();
  const clear = clearHfConnectCookieHeader(env.NODE_ENV);
  const result = await completeHuggingFaceConnect(
    {
      userId: input.userId,
      code: input.code,
      state: input.state,
      oauthError: input.oauthError,
      cookieHeader: input.cookieHeader,
      origin: hfPublicOrigin(env),
      now: input.now,
    },
    { db: input.db, http: input.http, env },
  );
  if (result.ok) {
    return redirect(settingsNotice(`Hugging Face account ${result.hfUsername} is linked.`), [clear]);
  }
  return redirect(settingsNotice(result.message), [clear]);
}

/** Disconnect. 401 without a session, then 404 when OAuth env is missing. Does not unlink in that case. */
export async function disconnectHuggingFace(input: {
  userId: string | null;
  env?: NodeJS.ProcessEnv;
  db?: Database;
}): Promise<Response> {
  if (!input.userId) return unauthorized();
  const env = input.env ?? process.env;
  if (!hfOAuthConfigured(env)) return hfNotConfiguredResponse();
  const db = input.db ?? getRuntimeDb();
  await unlinkHuggingFaceForUser(input.userId, db);
  return redirect(settingsNotice(DISCONNECT_HF_NOTICE));
}
