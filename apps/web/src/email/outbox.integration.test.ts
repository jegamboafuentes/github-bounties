import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { saveEmailNotificationPreferences } from "../profile/settings";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { emailOutbox, users } from "../db/schema";
import type { TransactionalEmailAdapter } from "./adapter";
import { claimEmailOutbox, deliverOutbox, enqueueEmailForUser } from "./outbox";
import { persistGoogleSignIn } from "./sign-in";
import { welcomeIdempotencyKey } from "./templates";

loadDotenvFiles();

function adapterScript(steps: Array<"ok" | "fail">): {
  adapter: TransactionalEmailAdapter;
  keys: string[];
} {
  const keys: string[] = [];
  let i = 0;
  const adapter: TransactionalEmailAdapter = {
    async send(message) {
      keys.push(message.idempotencyKey);
      const step = steps[Math.min(i, steps.length - 1)] ?? "ok";
      i += 1;
      if (step === "fail") {
        return { ok: false, reason: "provider_error", error: "timeout" };
      }
      return { ok: true, providerMessageId: `msg-${i}` };
    },
  };
  return { adapter, keys };
}

describe("email outbox", () => {
  it("welcomes once, retries a failed send, and does not double-send after success", async () => {
    const { db, sql: pg } = createDb();
    const googleSub = `test-welcome-${randomUUID()}`;
    const script = adapterScript(["fail", "ok", "ok"]);
    try {
      const first = await persistGoogleSignIn(
        {
          googleSub,
          email: "ada@example.com",
          displayName: "Ada",
          avatarUrl: "https://lh3.googleusercontent.com/a/ada",
        },
        { db, adapter: script.adapter, env: {} },
      );
      assert.equal(script.keys.length, 1);
      assert.equal(script.keys[0], welcomeIdempotencyKey(first.id));

      const pending = await db.select().from(emailOutbox).where(eq(emailOutbox.userId, first.id));
      assert.equal(pending.length, 1);
      assert.equal(pending[0]?.status, "pending");
      assert.equal(pending[0]?.attemptCount, 1);
      assert.equal(pending[0]?.toEmail, "ada@example.com");

      const second = await persistGoogleSignIn(
        {
          googleSub,
          email: "ada@example.com",
          displayName: "Ada Lovelace",
          avatarUrl: null,
        },
        { db, adapter: script.adapter, env: {} },
      );
      assert.equal(second.id, first.id);
      assert.equal(script.keys.length, 2);
      assert.equal(script.keys[1], script.keys[0]);

      const sent = await db.select().from(emailOutbox).where(eq(emailOutbox.userId, first.id));
      assert.equal(sent.length, 1);
      assert.equal(sent[0]?.status, "sent");
      assert.equal(sent[0]?.providerMessageId, "msg-2");

      const third = await persistGoogleSignIn(
        {
          googleSub,
          email: "ada@example.com",
          displayName: "Ada Lovelace",
          avatarUrl: null,
        },
        { db, adapter: script.adapter, env: {} },
      );
      assert.equal(third.id, first.id);
      assert.equal(script.keys.length, 2);

      const rows = await db.select().from(users).where(eq(users.googleSub, googleSub));
      assert.equal(rows.length, 1);
      assert.ok(rows[0]?.welcomeEnqueuedAt);
    } finally {
      await pg.end({ timeout: 5 });
    }
  });

  it("does not welcome users who already existed before this enqueue", async () => {
    const { db, sql: pg } = createDb();
    const googleSub = `test-existing-${randomUUID()}`;
    const script = adapterScript(["ok"]);
    try {
      const created = await db
        .insert(users)
        .values({
          googleSub,
          email: "old@example.com",
          displayName: "Old",
          welcomeEnqueuedAt: new Date("2026-01-01T00:00:00.000Z"),
        })
        .returning();
      const user = created[0];
      assert.ok(user);

      await persistGoogleSignIn(
        {
          googleSub,
          email: "old@example.com",
          displayName: "Old",
          avatarUrl: null,
        },
        { db, adapter: script.adapter, env: {} },
      );
      const rows = await db.select().from(emailOutbox).where(eq(emailOutbox.userId, user.id));
      assert.equal(rows.length, 0);
      assert.equal(script.keys.length, 0);
    } finally {
      await pg.end({ timeout: 5 });
    }
  });

  it("refuses a missing email and a GitHub noreply address", async () => {
    const { db, sql: pg } = createDb();
    const suffix = randomUUID();
    try {
      const [blank] = await db
        .insert(users)
        .values({
          googleSub: `blank-${suffix}`,
          email: "blank-placeholder@example.com",
          displayName: "Blank",
        })
        .returning();
      assert.ok(blank);
      await db.update(users).set({ email: "   " }).where(eq(users.id, blank.id));
      const missing = await enqueueEmailForUser(
        {
          userId: blank.id,
          template: "welcome",
          idempotencyKey: `welcome:${blank.id}`,
        },
        db,
      );
      assert.deepEqual(missing, { ok: false, reason: "missing_email" });

      const [noreply] = await db
        .insert(users)
        .values({
          googleSub: `noreply-${suffix}`,
          email: "blank-placeholder@example.com",
          displayName: "Noreply",
        })
        .returning();
      assert.ok(noreply);
      await db
        .update(users)
        .set({ email: "123+ada@users.noreply.github.com" })
        .where(eq(users.id, noreply.id));
      const rejected = await enqueueEmailForUser(
        {
          userId: noreply.id,
          template: "bounty_funded",
          idempotencyKey: `funded:${noreply.id}`,
          payload: { bountyTitle: "Parser" },
        },
        db,
      );
      assert.deepEqual(rejected, { ok: false, reason: "rejected_recipient" });

      const queued = await db
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.userId, blank.id));
      assert.equal(queued.length, 0);
    } finally {
      await pg.end({ timeout: 5 });
    }
  });

  it("leaves pending mail untouched when the provider secret is missing", async () => {
    const { db, sql: pg } = createDb();
    const suffix = randomUUID();
    try {
      const [user] = await db
        .insert(users)
        .values({
          googleSub: `secret-${suffix}`,
          email: "secret@example.com",
          displayName: "Secret",
        })
        .returning();
      assert.ok(user);
      const enqueued = await enqueueEmailForUser(
        {
          userId: user.id,
          template: "pr_merged",
          idempotencyKey: `merged:${user.id}`,
        },
        db,
      );
      assert.equal(enqueued.ok, true);

      const result = await deliverOutbox({ db, env: {}, userId: user.id });
      assert.equal(result.configured, false);
      assert.equal(result.reason, "missing_secret");
      assert.equal(result.claimed, 0);

      const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.userId, user.id));
      assert.equal(row?.status, "pending");
      assert.equal(row?.attemptCount, 0);
      assert.equal(row?.providerMessageId, null);
    } finally {
      await pg.end({ timeout: 5 });
    }
  });

  it("claims a row once under concurrency and reclaims only after the lease expires", async () => {
    const primary = createDb();
    const other = createDb();
    const suffix = randomUUID();
    try {
      const [user] = await primary.db
        .insert(users)
        .values({
          googleSub: `claim-${suffix}`,
          email: "claim@example.com",
          displayName: "Claim",
        })
        .returning();
      assert.ok(user);
      const enqueued = await enqueueEmailForUser(
        {
          userId: user.id,
          template: "bounty_settled",
          idempotencyKey: `settled:${suffix}`,
        },
        primary.db,
      );
      assert.equal(enqueued.ok, true);
      if (!enqueued.ok) return;

      const [left, right] = await Promise.all([
        claimEmailOutbox({ db: primary.db, workerId: "worker-a", limit: 5, userId: user.id }),
        claimEmailOutbox({ db: other.db, workerId: "worker-b", limit: 5, userId: user.id }),
      ]);
      const ids = [...left, ...right].map((row) => row.id);
      assert.equal(ids.length, 1);
      assert.equal(new Set(ids).size, 1);
      const owner = left.length === 1 ? "worker-a" : "worker-b";
      assert.equal([...left, ...right][0]?.claimedBy, owner);
      assert.equal([...left, ...right][0]?.status, "sending");

      const again = await claimEmailOutbox({
        db: other.db,
        workerId: "worker-c",
        limit: 5,
        userId: user.id,
      });
      assert.equal(again.length, 0);

      await primary.db.execute(sql`
        update email_outbox
        set claimed_at = now() - interval '10 minutes'
        where id = ${enqueued.id}::uuid
      `);
      const reclaimed = await claimEmailOutbox({
        db: other.db,
        workerId: "worker-d",
        limit: 5,
        userId: user.id,
        leaseSeconds: 300,
      });
      assert.equal(reclaimed.length, 1);
      assert.equal(reclaimed[0]?.id, enqueued.id);
      assert.equal(reclaimed[0]?.claimedBy, "worker-d");
      assert.equal(reclaimed[0]?.attemptCount, 2);
    } finally {
      await primary.sql.end({ timeout: 5 });
      await other.sql.end({ timeout: 5 });
    }
  });

  it("skips a disabled template and does not send a row queued before opt-out", async () => {
    const { db, sql: pg } = createDb();
    const googleSub = `test-prefs-${randomUUID()}`;
    const script = adapterScript(["ok"]);
    try {
      const user = await persistGoogleSignIn(
        {
          googleSub,
          email: "quiet@example.com",
          displayName: "Quiet",
          avatarUrl: null,
        },
        { db, adapter: script.adapter, env: { RESEND_API_KEY: "re_test" } },
      );
      await saveEmailNotificationPreferences(db, user.id, {
        bountyFunded: false,
        prMerged: true,
        bountySettled: true,
        poolClaimable: true,
      });
      const skipped = await enqueueEmailForUser(
        {
          userId: user.id,
          template: "bounty_funded",
          idempotencyKey: `bounty_funded:pref:${user.id}`,
        },
        db,
      );
      assert.equal(skipped.ok, false);
      if (!skipped.ok) assert.equal(skipped.reason, "preference_disabled");
      const funded = await db
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.idempotencyKey, `bounty_funded:pref:${user.id}`));
      assert.equal(funded.length, 0);

      const welcome = await enqueueEmailForUser(
        {
          userId: user.id,
          template: "welcome",
          idempotencyKey: welcomeIdempotencyKey(user.id),
        },
        db,
      );
      assert.equal(welcome.ok, true);

      const prKey = `pr_merged:pref:${user.id}`;
      const queued = await enqueueEmailForUser(
        { userId: user.id, template: "pr_merged", idempotencyKey: prKey },
        db,
      );
      assert.equal(queued.ok, true);
      await saveEmailNotificationPreferences(db, user.id, { prMerged: false });
      const before = script.keys.length;
      await deliverOutbox({ db, adapter: script.adapter, userId: user.id, env: { RESEND_API_KEY: "re_test" } });
      assert.equal(script.keys.includes(prKey), false);
      const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, prKey));
      assert.equal(row?.status, "failed");
      assert.equal(row?.lastError, "notification_preference_disabled");
      assert.ok(script.keys.length >= before);
    } finally {
      await pg.end({ timeout: 5 });
    }
  });
});
