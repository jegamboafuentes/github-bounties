import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Database } from "../db/client";
import { isMissingIdentitySchema } from "../db/errors";
import { identityFromGoogleProfile, upsertUserByGoogleSub, type UserRow } from "./users";

describe("Google profile → User identity", () => {
  it("requires google sub + email and skips unverified email", () => {
    assert.equal(identityFromGoogleProfile({}), null);
    assert.equal(identityFromGoogleProfile({ sub: "abc" }), null);
    assert.equal(identityFromGoogleProfile({ email: "a@b.c" }), null);
    assert.equal(
      identityFromGoogleProfile({ sub: "abc", email: "a@b.c", email_verified: false }),
      null,
    );
    assert.deepEqual(
      identityFromGoogleProfile({
        sub: "abc",
        email: "a@b.c",
        name: "Ada",
        picture: "https://lh3.googleusercontent.com/a/ada",
        email_verified: true,
      }),
      {
        googleSub: "abc",
        email: "a@b.c",
        displayName: "Ada",
        avatarUrl: "https://lh3.googleusercontent.com/a/ada",
      },
    );
    assert.deepEqual(
      identityFromGoogleProfile({ sub: "abc", email: "pat@example.com" }),
      { googleSub: "abc", email: "pat@example.com", displayName: "pat", avatarUrl: null },
    );
    assert.equal(
      identityFromGoogleProfile({
        sub: "abc",
        email: "pat@example.com",
        picture: "javascript:alert(1)",
      })?.avatarUrl,
      null,
    );
  });
});

describe("sign-in schema fallback", () => {
  const row: UserRow = {
    id: "00000000-0000-4000-8000-0000000000aa",
    googleSub: "abc",
    email: "pat@example.com",
    displayName: "Pat",
    avatarUrl: null,
    walletAddress: null,
    lastSeenAt: new Date("2026-09-22T00:00:00.000Z"),
    createdAt: new Date("2026-09-22T00:00:00.000Z"),
    updatedAt: new Date("2026-09-22T00:00:00.000Z"),
  };

  it("recognizes a missing outbox or identity column", () => {
    assert.equal(isMissingIdentitySchema(Object.assign(new Error("nope"), { code: "42P01" })), true);
    assert.equal(isMissingIdentitySchema(Object.assign(new Error("nope"), { code: "42703" })), true);
    assert.equal(
      isMissingIdentitySchema(new Error('column "last_seen_at" of relation "users" does not exist')),
      true,
    );
    assert.equal(isMissingIdentitySchema(Object.assign(new Error("duplicate"), { code: "23505" })), false);
  });

  it("saves google_sub without welcome when migrate 0006 is absent", async () => {
    let legacy = false;
    const db = {
      async transaction() {
        const err = new Error('relation "email_outbox" does not exist');
        (err as { code: string }).code = "42P01";
        throw err;
      },
      insert() {
        legacy = true;
        return {
          values() {
            return {
              onConflictDoUpdate() {
                return { returning: async () => [row] };
              },
            };
          },
        };
      },
    } as unknown as Database;

    const saved = await upsertUserByGoogleSub(
      { googleSub: "abc", email: "pat@example.com", displayName: "Pat", avatarUrl: null },
      db,
      {},
    );
    assert.equal(legacy, true);
    assert.equal(saved.id, row.id);
    assert.equal(saved.email, "pat@example.com");
  });

  it("does not swallow unrelated upsert failures", async () => {
    const db = {
      async transaction() {
        const err = new Error("duplicate key");
        (err as { code: string }).code = "23505";
        throw err;
      },
    } as unknown as Database;
    await assert.rejects(
      () =>
        upsertUserByGoogleSub(
          { googleSub: "abc", email: "pat@example.com", displayName: "Pat", avatarUrl: null },
          db,
          {},
        ),
      /duplicate key/,
    );
  });
});
