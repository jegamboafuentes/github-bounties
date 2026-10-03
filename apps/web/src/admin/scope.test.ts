import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccessDeps, ApiKeyRecord } from "../api/access/deps";
import { authenticateBearer, createApiKey, handleMe, listApiKeys } from "../api/access/handlers";
import { PublicApiError } from "../api/public/errors";
import { parseScopes, storedApiKeyScopes } from "../api/access/policy";

describe("admin API key scope", () => {
  it("keeps admin when a stored key is loaded", () => {
    assert.deepEqual(storedApiKeyScopes(["read", "admin", "bogus"]), ["read", "admin"]);
    assert.deepEqual(storedApiKeyScopes(["write", "money"]), ["write", "money"]);
    assert.deepEqual(storedApiKeyScopes(null), []);
  });

  it("reports admin on /me after the key is reloaded", async () => {
    const keys: ApiKeyRecord[] = [];
    const deps = {
      env: {
        ADMIN_EMAILS: "ada@example.com",
        API_KEY_HMAC_SECRET: "test-hmac-secret-value",
        CDP_NETWORK: "base-sepolia",
      },
      now: () => new Date("2026-10-03T00:00:00.000Z"),
      async loadAdminActor() {
        return { email: "ada@example.com", googleSub: "sub-ada" };
      },
      async insertKey(row: ApiKeyRecord) {
        keys.push(row);
      },
      async findKeyByHash(hash: string) {
        const row = keys.find((item) => item.keyHash === hash);
        return row ? { ...row, scopes: storedApiKeyScopes(row.scopes) } : null;
      },
      async listKeys(userId: string) {
        return keys
          .filter((row) => row.userId === userId)
          .map((row) => ({ ...row, scopes: storedApiKeyScopes(row.scopes) }));
      },
      async touchKey() {},
      async loadMe() {
        return {
          id: "user-1",
          displayName: "Ada",
          email: "ada@example.com",
          walletAddress: null,
          githubLogin: null,
          huggingface: null,
        };
      },
    } as AccessDeps;
    const created = await createApiKey({ userId: "user-1", name: "agent", scopes: ["read", "admin"] }, deps);
    assert.deepEqual(created.key.scopes, ["read", "admin"]);
    const principal = await authenticateBearer(`Bearer ${created.token}`, "127.0.0.1", deps);
    assert.ok(principal?.scopes.has("admin"));
    const me = await handleMe(principal, deps);
    assert.deepEqual((me.body as { apiKey: { scopes: string[] } }).apiKey.scopes, ["read", "admin"]);
    const listed = await listApiKeys("user-1", deps);
    assert.deepEqual(listed[0]?.scopes, ["read", "admin"]);
  });

  it("refuses the admin scope for non-admins in the parser and create path", async () => {
    assert.throws(
      () => parseScopes(["read", "admin"]),
      (err: unknown) => err instanceof PublicApiError && /cannot be granted/i.test(err.message),
    );
    assert.deepEqual(parseScopes(["admin"], { allowAdmin: true }), ["admin"]);

    await assert.rejects(
      () =>
        createApiKey(
          { userId: "user-1", name: "agent", scopes: ["read", "admin"] },
          {
            env: { ADMIN_EMAILS: "ada@example.com" },
            now: () => new Date(),
            async loadAdminActor() {
              return { email: "other@example.com", googleSub: "sub" };
            },
            async insertKey() {},
            async moneyGate() {
              return { wallet: true, github: true };
            },
          } as never,
        ),
      (err: unknown) => err instanceof PublicApiError,
    );
  });
});
