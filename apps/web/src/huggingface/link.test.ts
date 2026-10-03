import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HF_CONNECT_COOKIE, readCookie } from "./cookie";
import { completeHuggingFaceConnect } from "./complete";
import {
  HF_DEV_REDIRECT_URI,
  HF_LOCAL_REDIRECT_URI,
  HF_OAUTH_SCOPE,
  HF_PROD_REDIRECT_URI,
  hfNotConfiguredBody,
} from "./env";
import { disconnectHuggingFace, finishHuggingFaceConnect, startHuggingFaceConnect } from "./http";
import type { HfHttp, HfIdentity } from "./oauth";
import { huggingfaceAuthorizeUrl } from "./oauth";
import { HfAccountTakenError, linkHuggingFaceAccount } from "./persist";
import { pkceHash, signHfConnectState, verifyHfConnectState } from "./state";
import { DISCONNECT_HF_NOTICE, unlinkHuggingFaceForUser } from "./unlink";
import { hfCallbackUrl, hfPublicOrigin } from "./urls";

const ENV = {
  HF_OAUTH_CLIENT_ID: "hf-client",
  HF_OAUTH_CLIENT_SECRET: "hf-secret-do-not-store",
  PUBLIC_BASE_URL: "https://dev.githubbounties.xyz",
  NODE_ENV: "test",
};

const SUB = "61d2f90c3c2083e1c08af22d";
const TOKEN = "hf_access_SHOULD_NOT_PERSIST";

type Stored = {
  userId: string;
  hfSub: string;
  hfUsername: string;
  hfAvatarUrl: string | null;
  linkedAt: Date;
};

function linkDb(options?: { ownerUserId?: string | null; race?: boolean }) {
  const inserted: Stored[] = [];
  let inserts = 0;
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit: async () =>
                  options?.ownerUserId ? [{ userId: options.ownerUserId }] : [],
              };
            },
          };
        },
      };
    },
    insert() {
      inserts += 1;
      return {
        values(values: Stored) {
          inserted.push(values);
          return {
            onConflictDoUpdate() {
              return {
                returning: async () => {
                  if (options?.race) {
                    const err = new Error(
                      'duplicate key value violates unique constraint "hf_links_hf_sub_uidx"',
                    ) as Error & { code: string };
                    err.code = "23505";
                    throw err;
                  }
                  return [
                    {
                      id: "row-1",
                      ...values,
                      unlinkedAt: null,
                      createdAt: values.linkedAt,
                      updatedAt: values.linkedAt,
                    },
                  ];
                },
              };
            },
          };
        },
      };
    },
  };
  return { db, inserted, insertCount: () => inserts };
}

function unlinkDb(row: { userId: string; hfUsername: string } | null) {
  let deletes = 0;
  const db = {
    delete() {
      deletes += 1;
      return {
        where() {
          return {
            returning: async () => (row ? [row] : []),
          };
        },
      };
    },
  };
  return { db, deleteCount: () => deletes };
}

function hfHttp(profile: { sub?: string; preferred_username?: string; picture?: string }): {
  http: HfHttp;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const http: HfHttp = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/oauth/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: TOKEN }) };
    }
    return { ok: true, status: 200, json: async () => profile };
  };
  return { http, calls };
}

describe("Hugging Face redirect URI", () => {
  it("uses PUBLIC_BASE_URL then AUTH_URL and the registered DEV and PROD URIs", () => {
    assert.equal(HF_DEV_REDIRECT_URI, "https://dev.githubbounties.xyz/huggingface/callback");
    assert.equal(HF_PROD_REDIRECT_URI, "https://githubbounties.xyz/huggingface/callback");
    assert.equal(HF_LOCAL_REDIRECT_URI, "http://localhost:3000/huggingface/callback");
    assert.equal(hfCallbackUrl("https://dev.githubbounties.xyz"), HF_DEV_REDIRECT_URI);
    assert.equal(hfCallbackUrl("https://githubbounties.xyz"), HF_PROD_REDIRECT_URI);
    assert.equal(
      hfPublicOrigin({ PUBLIC_BASE_URL: "https://dev.githubbounties.xyz/" }),
      "https://dev.githubbounties.xyz",
    );
    assert.equal(
      hfPublicOrigin({ AUTH_URL: "https://githubbounties.xyz" }),
      "https://githubbounties.xyz",
    );
    assert.equal(
      hfCallbackUrl(hfPublicOrigin({ PUBLIC_BASE_URL: "https://dev.githubbounties.xyz", AUTH_URL: "https://githubbounties.xyz" })),
      HF_DEV_REDIRECT_URI,
    );
    assert.equal(HF_OAUTH_SCOPE, "openid profile");
  });
});

describe("link and unlink Hugging Face", () => {
  const identity: HfIdentity = {
    hfSub: SUB,
    hfUsername: "lysandre",
    hfAvatarUrl: "https://huggingface.co/avatars/lysandre.png",
  };

  it("stores sub, username, avatar, and linked_at and does not store a token", async () => {
    const bag = linkDb();
    const row = await linkHuggingFaceAccount("user-1", identity, bag.db as never);
    assert.equal(row.userId, "user-1");
    assert.equal(row.hfSub, SUB);
    assert.equal(row.hfUsername, "lysandre");
    assert.equal(row.hfAvatarUrl, identity.hfAvatarUrl);
    assert.ok(row.linkedAt instanceof Date);
    assert.equal(JSON.stringify(bag.inserted).includes("access"), false);
    assert.equal("accessToken" in bag.inserted[0]!, false);
  });

  it("refuses a duplicate link when the HF account belongs to someone else", async () => {
    const bag = linkDb({ ownerUserId: "other-user" });
    await assert.rejects(
      () => linkHuggingFaceAccount("user-1", identity, bag.db as never),
      (err: unknown) => err instanceof HfAccountTakenError && err.code === "hf_account_taken",
    );
    assert.equal(bag.insertCount(), 0);
  });

  it("refuses the unique-index race as the same duplicate", async () => {
    const bag = linkDb({ race: true });
    await assert.rejects(
      () => linkHuggingFaceAccount("user-1", identity, bag.db as never),
      HfAccountTakenError,
    );
    assert.equal(bag.insertCount(), 1);
  });

  it("updates the same user's link", async () => {
    const bag = linkDb({ ownerUserId: "user-1" });
    const row = await linkHuggingFaceAccount(
      "user-1",
      { ...identity, hfUsername: "lysandre-renamed" },
      bag.db as never,
    );
    assert.equal(row.hfUsername, "lysandre-renamed");
    assert.equal(row.userId, "user-1");
  });

  it("deletes only that user's hf_links row", async () => {
    const bag = unlinkDb({ userId: "user-1", hfUsername: "lysandre" });
    const result = await unlinkHuggingFaceForUser("user-1", bag.db as never);
    assert.deepEqual(result, { deleted: true, hfUsername: "lysandre" });
    assert.equal(bag.deleteCount(), 1);
    assert.equal(DISCONNECT_HF_NOTICE, "Hugging Face account unlinked. Product login stays Google.");
  });

  it("is a no-op when the user has no hf_links row and rejects an empty user id", async () => {
    const bag = unlinkDb(null);
    assert.deepEqual(await unlinkHuggingFaceForUser("user-1", bag.db as never), {
      deleted: false,
      hfUsername: null,
    });
    await assert.rejects(() => unlinkHuggingFaceForUser("", bag.db as never), /userId is required/);
    await assert.rejects(() => linkHuggingFaceAccount("", identity, bag.db as never), /userId is required/);
  });
});

describe("Hugging Face OAuth connect", () => {
  it("returns 503 hf_not_configured when either secret is missing and does not link", async () => {
    for (const env of [
      {},
      { HF_OAUTH_CLIENT_ID: "id-only" },
      { HF_OAUTH_CLIENT_SECRET: "secret-only" },
      { HF_OAUTH_CLIENT_ID: "  ", HF_OAUTH_CLIENT_SECRET: "secret" },
    ]) {
      const start = startHuggingFaceConnect({ userId: "user-1", env });
      assert.equal(start.status, 503);
      const body = (await start.json()) as ReturnType<typeof hfNotConfiguredBody>;
      assert.equal(body.ok, false);
      assert.equal(body.error, "hf_not_configured");
      assert.ok(body.missing.length > 0);
      assert.match(body.message, /HF_OAUTH_CLIENT_ID and HF_OAUTH_CLIENT_SECRET/);

      const callback = await finishHuggingFaceConnect({
        userId: "user-1",
        code: "code",
        state: "state",
        env,
      });
      assert.equal(callback.status, 503);
      assert.equal(((await callback.json()) as { error: string }).error, "hf_not_configured");

      let deleted = false;
      const disconnect = await disconnectHuggingFace({
        userId: "user-1",
        env,
        db: {
          delete() {
            deleted = true;
            return { where: () => ({ returning: async () => [] }) };
          },
        } as never,
      });
      assert.equal(disconnect.status, 503);
      assert.equal(((await disconnect.json()) as { error: string }).error, "hf_not_configured");
      assert.equal(deleted, false);
    }
  });

  it("sends the signed-in user to Hugging Face with openid profile and PKCE", () => {
    const response = startHuggingFaceConnect({ userId: "user-1", env: ENV });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.origin + location.pathname, "https://huggingface.co/oauth/authorize");
    assert.equal(location.searchParams.get("response_type"), "code");
    assert.equal(location.searchParams.get("client_id"), "hf-client");
    assert.equal(location.searchParams.get("redirect_uri"), HF_DEV_REDIRECT_URI);
    assert.equal(location.searchParams.get("scope"), "openid profile");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.ok(location.searchParams.get("code_challenge"));
    assert.equal(location.toString().includes("hf-secret-do-not-store"), false);
    assert.equal(location.toString().includes("email"), false);
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, new RegExp(`^${HF_CONNECT_COOKIE}=`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Path=\/huggingface\/callback/);
    const state = verifyHfConnectState(location.searchParams.get("state"));
    assert.equal(state?.userId, "user-1");
    const verifier = readCookie(cookie, HF_CONNECT_COOKIE);
    assert.equal(state?.pkceHash, verifier ? pkceHash(verifier) : "");
  });

  it("links from the callback and drops the access token", async () => {
    const started = startHuggingFaceConnect({ userId: "user-1", env: ENV });
    const location = new URL(started.headers.get("location") ?? "");
    const verifier = readCookie(started.headers.get("set-cookie"), HF_CONNECT_COOKIE);
    const { http, calls } = hfHttp({
      sub: SUB,
      preferred_username: "lysandre",
      picture: "https://cdn-avatars.huggingface.co/v1/production/uploads/lysandre.png",
    });
    const bag = linkDb();
    const result = await completeHuggingFaceConnect(
      {
        userId: "user-1",
        code: "auth-code",
        state: location.searchParams.get("state"),
        cookieHeader: `${HF_CONNECT_COOKIE}=${verifier}`,
      },
      { db: bag.db as never, http, env: ENV },
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.hfUsername, "lysandre");
    assert.equal(bag.inserted[0]?.hfSub, SUB);
    assert.equal(bag.inserted[0]?.hfUsername, "lysandre");
    assert.equal(
      bag.inserted[0]?.hfAvatarUrl,
      "https://cdn-avatars.huggingface.co/v1/production/uploads/lysandre.png",
    );
    assert.equal(JSON.stringify(bag.inserted).includes(TOKEN), false);
    const tokenCall = calls[0];
    assert.match(String(tokenCall?.init?.body), /grant_type=authorization_code/);
    assert.match(String(tokenCall?.init?.body), /code_verifier=/);
    assert.match(String(tokenCall?.init?.body), /client_secret=hf-secret-do-not-store/);
    assert.equal(calls[1]?.url, "https://huggingface.co/oauth/userinfo");
    const authorization = new Headers(calls[1]?.init?.headers).get("authorization");
    assert.equal(authorization, `Bearer ${TOKEN}`);
  });

  it("drops a non-https avatar and refuses a duplicate during connect", async () => {
    const state = signHfConnectState({ userId: "user-1", pkceHash: pkceHash("verifier-1") });
    const { http } = hfHttp({
      sub: SUB,
      preferred_username: "lysandre",
      picture: "http://example.test/avatar.png",
    });
    const bag = linkDb();
    const linked = await completeHuggingFaceConnect(
      {
        userId: "user-1",
        code: "auth-code",
        state,
        cookieHeader: `${HF_CONNECT_COOKIE}=verifier-1`,
      },
      { db: bag.db as never, http, env: ENV },
    );
    assert.equal(linked.ok, true);
    assert.equal(bag.inserted[0]?.hfAvatarUrl, null);

    const taken = linkDb({ ownerUserId: "other-user" });
    const refused = await completeHuggingFaceConnect(
      {
        userId: "user-1",
        code: "auth-code",
        state,
        cookieHeader: `${HF_CONNECT_COOKIE}=verifier-1`,
      },
      { db: taken.db as never, http, env: ENV },
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error, "hf_account_taken");
    assert.equal(taken.insertCount(), 0);
  });

  it("disconnects when configured and returns 401 without a session", async () => {
    const bag = unlinkDb({ userId: "user-1", hfUsername: "lysandre" });
    const gone = await disconnectHuggingFace({ userId: "user-1", env: ENV, db: bag.db as never });
    assert.equal(gone.status, 302);
    assert.match(gone.headers.get("location") ?? "", /Hugging%20Face%20account%20unlinked/);
    assert.equal(bag.deleteCount(), 1);

    const anon = await disconnectHuggingFace({ userId: null, env: ENV, db: bag.db as never });
    assert.equal(anon.status, 401);
    assert.equal(((await anon.json()) as { error: string }).error, "unauthorized");
    assert.equal(bag.deleteCount(), 1);
  });
});

describe("authorize URL scope", () => {
  it("does not ask for email or repo scopes", () => {
    const url = new URL(
      huggingfaceAuthorizeUrl({
        state: "state",
        redirectUri: HF_PROD_REDIRECT_URI,
        codeChallenge: "challenge",
        env: ENV,
      }),
    );
    assert.equal(url.searchParams.get("scope"), "openid profile");
    assert.equal(url.searchParams.get("redirect_uri"), HF_PROD_REDIRECT_URI);
  });
});
