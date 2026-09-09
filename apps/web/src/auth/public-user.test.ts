import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  githubConnectStubBody,
  githubConnectStubResponse,
  jsonMe,
  toPublicUser,
  unauthorizedJson,
} from "./public-user";

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
    assert.deepEqual(await ok.json(), { ok: true, user });

    const meDenied = jsonMe(null);
    assert.equal(meDenied.status, 401);
  });

  it("stubs Connect GitHub as 501 for signed-in users and 401 otherwise", async () => {
    const denied = githubConnectStubResponse(null);
    assert.equal(denied.status, 401);

    const stub = githubConnectStubResponse({
      id: "u",
      google_sub: "sub",
      email: "a@b.c",
      display_name: "A",
    });
    assert.equal(stub.status, 501);
    const body = await stub.json();
    assert.equal(body.stub, true);
    assert.equal(body.ticket, "V1-3");
    assert.equal(body.wired, false);
    assert.equal(githubConnectStubBody().error, "not_implemented");
  });
});
