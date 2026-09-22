import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { users } from "../db/schema";
import { upsertUserByGoogleSub } from "./users";

loadDotenvFiles();

describe("upsertUserByGoogleSub", () => {
  it("inserts then updates the same google_sub", async () => {
    const { db, sql } = createDb();
    const googleSub = `test-google-upsert-${randomUUID()}`;
    try {
      const firstSeen = new Date("2026-09-22T01:00:00.000Z");
      const secondSeen = new Date("2026-09-22T02:00:00.000Z");
      const created = await upsertUserByGoogleSub(
        {
          googleSub,
          email: "first@example.com",
          displayName: "First Name",
          avatarUrl: "https://lh3.googleusercontent.com/a/first",
        },
        db,
        { now: firstSeen },
      );
      assert.equal(created.created, true);
      assert.equal(created.user.googleSub, googleSub);
      assert.equal(created.user.email, "first@example.com");
      assert.equal(created.user.displayName, "First Name");
      assert.equal(created.user.avatarUrl, "https://lh3.googleusercontent.com/a/first");
      assert.equal(created.user.lastSeenAt.toISOString(), firstSeen.toISOString());
      assert.equal(created.user.welcomeEnqueuedAt, null);

      const updated = await upsertUserByGoogleSub(
        {
          googleSub,
          email: "second@example.com",
          displayName: "Second Name",
          avatarUrl: null,
        },
        db,
        { now: secondSeen },
      );
      assert.equal(updated.created, false);
      assert.equal(updated.user.id, created.user.id);
      assert.equal(updated.user.email, "second@example.com");
      assert.equal(updated.user.displayName, "Second Name");
      assert.equal(updated.user.avatarUrl, "https://lh3.googleusercontent.com/a/first");
      assert.equal(updated.user.createdAt.toISOString(), created.user.createdAt.toISOString());
      assert.equal(updated.user.lastSeenAt.toISOString(), secondSeen.toISOString());

      const replacedAvatar = await upsertUserByGoogleSub(
        {
          googleSub,
          email: "second@example.com",
          displayName: "Second Name",
          avatarUrl: "https://lh3.googleusercontent.com/a/second",
        },
        db,
        { now: secondSeen },
      );
      assert.equal(replacedAvatar.user.id, created.user.id);
      assert.equal(replacedAvatar.user.avatarUrl, "https://lh3.googleusercontent.com/a/second");

      const rows = await db.select().from(users).where(eq(users.googleSub, googleSub));
      assert.equal(rows.length, 1);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
