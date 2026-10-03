import { normalizeAvatarUrl } from "../auth/users";
import {
  HF_AUTHORIZE_URL,
  HF_OAUTH_SCOPE,
  HF_TOKEN_URL,
  HF_USERINFO_URL,
  readHfOAuthEnv,
} from "./env";

export type HfHttp = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type HfIdentity = {
  hfSub: string;
  hfUsername: string;
  hfAvatarUrl: string | null;
};

const defaultHttp: HfHttp = async (url, init) => {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, json: () => res.json() as Promise<unknown> };
};

export function huggingfaceAuthorizeUrl(args: {
  state: string;
  redirectUri: string;
  codeChallenge: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const { clientId } = readHfOAuthEnv(args.env ?? process.env);
  const url = new URL(HF_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("scope", HF_OAUTH_SCOPE);
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", args.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * Exchange the code, then read userinfo. The access token is not returned.
 * Callers must not persist it.
 */
export async function exchangeHfAuthorizationCode(args: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  env?: NodeJS.ProcessEnv;
  http?: HfHttp;
}): Promise<HfIdentity> {
  const { clientId, clientSecret } = readHfOAuthEnv(args.env ?? process.env);
  if (!clientId || !clientSecret) {
    throw new Error("Hugging Face connect is not available.");
  }
  const http = args.http ?? defaultHttp;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: args.codeVerifier,
  });
  const tokenRes = await http(HF_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  const accessToken = tokenJson.access_token?.trim() ?? "";
  if (!tokenRes.ok || !accessToken) {
    throw new Error(`Hugging Face token exchange failed (${tokenJson.error ?? tokenRes.status})`);
  }

  const infoRes = await http(HF_USERINFO_URL, {
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
  });
  const profile = (await infoRes.json()) as {
    sub?: string;
    preferred_username?: string;
    picture?: string;
  };
  if (!infoRes.ok) {
    throw new Error(`Hugging Face userinfo failed (HTTP ${infoRes.status})`);
  }
  const hfSub = profile.sub?.trim() ?? "";
  const hfUsername = profile.preferred_username?.trim() ?? "";
  if (!hfSub || !hfUsername) {
    throw new Error("Hugging Face userinfo missing sub or preferred_username");
  }
  return {
    hfSub,
    hfUsername,
    hfAvatarUrl: normalizeAvatarUrl(profile.picture),
  };
}
