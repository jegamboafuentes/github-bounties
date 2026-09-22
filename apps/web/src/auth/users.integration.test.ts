import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { bounties, emailOutbox, users } from "../db/schema";
import { setUserWalletAddress, upsertUserByGoogleSub } from "./users";

loadDotenvFiles();

describe("upsertUserByGoogleSub", () => {
  it("keeps one user and one welcome across repeat logins with zero bounties", async () => {
    const { db, sql } = createDb();
    const googleSub = `test-google-upsert-${randomUUID()}`;
    try {
      const created = await upsertUserByGoogleSub(
        {
          googleSub,
          email: "first@example.com",
          displayName: "First Name",
          avatarUrl: "https://lh3.googleusercontent.com/a/first",
        },
        db,
        {},
      );
      assert.equal(created.googleSub, googleSub);
      assert.equal(created.email, "first@example.com");
      assert.equal(created.displayName, "First Name");
      assert.equal(created.avatarUrl, "https://lh3.googleusercontent.com/a/first");
      assert.ok(created.lastSeenAt);
      assert.ok(created.createdAt);

      const updated = await upsertUserByGoogleSub(
        {
          googleSub,
          email: "second@example.com",
          displayName: "Second Name",
          avatarUrl: null,
        },
        db,
        {},
      );
      assert.equal(updated.id, created.id);
      assert.equal(updated.email, "second@example.com");
      assert.equal(updated.displayName, "Second Name");
      assert.equal(updated.avatarUrl, "https://lh3.googleusercontent.com/a/first");
      assert.equal(updated.createdAt.getTime(), created.createdAt.getTime());
      assert.ok(updated.lastSeenAt.getTime() >= created.lastSeenAt.getTime());

      const renamed = await upsertUserByGoogleSub(
        {
          googleSub,
          email: "second@example.com",
          displayName: "Second Name",
          avatarUrl: "https://lh3.googleusercontent.com/a/second",
        },
        db,
        {},
      );
      assert.equal(renamed.avatarUrl, "https://lh3.googleusercontent.com/a/second");

      const rows = await db.select().from(users).where(eq(users.googleSub, googleSub));
      assert.equal(rows.length, 1);

      const posted = await db.select().from(bounties).where(eq(bounties.posterUserId, created.id));
      assert.equal(posted.length, 0);

      const mail = await db.select().from(emailOutbox).where(eq(emailOutbox.userId, created.id));
      assert.equal(mail.length, 1);
      assert.equal(mail[0]?.template, "welcome");
      assert.equal(mail[0]?.status, "pending");
      assert.equal(mail[0]?.idempotencyKey, `welcome:user:${created.id}`);
      assert.equal(mail[0]?.toEmail, "second@example.com");
      assert.match(mail[0]?.html ?? "", /logo-1\.png/);
      assert.match(mail[0]?.bodyText ?? "", /Welcome, First Name\./);

      const seen = renamed.lastSeenAt;
      const withWallet = await setUserWalletAddress(
        created.id,
        "0x0000000000000000000000000000000000000001",
        db,
      );
      assert.equal(withWallet.lastSeenAt.getTime(), seen.getTime());
      assert.equal(withWallet.walletAddress, "0x0000000000000000000000000000000000000001");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
