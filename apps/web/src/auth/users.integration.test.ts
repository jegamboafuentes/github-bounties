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
      const created = await upsertUserByGoogleSub(
        {
          googleSub,
          email: "first@example.com",
          displayName: "First Name",
        },
        db,
      );
      assert.equal(created.googleSub, googleSub);
      assert.equal(created.email, "first@example.com");
      assert.equal(created.displayName, "First Name");

      const updated = await upsertUserByGoogleSub(
        {
          googleSub,
          email: "second@example.com",
          displayName: "Second Name",
        },
        db,
      );
      assert.equal(updated.id, created.id);
      assert.equal(updated.email, "second@example.com");
      assert.equal(updated.displayName, "Second Name");

      const rows = await db.select().from(users).where(eq(users.googleSub, googleSub));
      assert.equal(rows.length, 1);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
