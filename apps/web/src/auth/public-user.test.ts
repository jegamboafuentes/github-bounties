import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonMe, toPublicUser, unauthorizedJson } from "./public-user";

describe("authz JSON helpers", () => {
  it("returns 401 for missing users and 200 for /api/me", async () => {
    const denied = unauthorizedJson();
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { ok: false, error: "unauthorized" });

    const user = toPublicUser({
      id: "00000000-0000-4000-8000-000000000099",
      googleSub: "google-sub-99",
      email: "user@example.com",
      displayName: "Pat",
      walletAddress: null,
      createdAt: new Date("2026-09-09T00:00:00.000Z"),
      updatedAt: new Date("2026-09-09T00:00:00.000Z"),
    });
    const ok = jsonMe(user);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), {
      ok: true,
      user: {
        id: user.id,
        google_sub: user.google_sub,
        email: user.email,
        display_name: user.display_name,
        wallet_address: null,
      },
    });

    const meDenied = jsonMe(null);
    assert.equal(meDenied.status, 401);
  });
});
