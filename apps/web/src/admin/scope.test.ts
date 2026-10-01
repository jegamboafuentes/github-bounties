import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApiKey } from "../api/access/handlers";
import { PublicApiError } from "../api/public/errors";
import { parseScopes } from "../api/access/policy";

describe("admin API key scope", () => {
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
