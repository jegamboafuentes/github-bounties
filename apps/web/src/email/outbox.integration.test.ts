import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { loadDotenvFiles } from "../db/load-dotenv";
import { emailOutbox, users } from "../db/schema";
import { dispatchEmailOutbox, EMAIL_OUTBOX_MAX_ATTEMPTS } from "./dispatch";
import { enqueueTransactionalEmail, enqueueWelcomeOnce } from "./outbox";
import type { TransactionalEmailProvider } from "./provider";

loadDotenvFiles();

function isCheckViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 6 && current; i++) {
    if (typeof current === "object" && current !== null && "code" in current) {
      if ((current as { code?: string }).code === "23514") return true;
    }
    const message = current instanceof Error ? current.message : String(current ?? "");
    if (/23514|check constraint|email_outbox_to_email_present/i.test(message)) return true;
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function insertUser(db: ReturnType<typeof createDb>["db"], suffix: string) {
  const [user] = await db
    .insert(users)
    .values({
      googleSub: `email-outbox-${suffix}`,
      email: `outbox-${suffix}@example.com`,
      displayName: "Outbox Tester",
    })
    .returning();
  if (!user) throw new Error("user insert failed");
  return user;
}

describe("email outbox", () => {
  it("refuses a missing email and inserts welcome at most once", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    try {
      const user = await insertUser(db, suffix);
      const missing = await enqueueWelcomeOnce(db, { ...user, email: "  " });
      assert.deepEqual(missing, { enqueued: false, reason: "missing_email" });

      const first = await enqueueWelcomeOnce(db, user, {
        PUBLIC_BASE_URL: "https://dev.githubbounties.xyz",
      });
      const second = await enqueueWelcomeOnce(db, user, {
        PUBLIC_BASE_URL: "https://dev.githubbounties.xyz",
      });
      assert.equal(first.enqueued, true);
      assert.deepEqual(second, { enqueued: false, reason: "duplicate" });

      const rows = await db.select().from(emailOutbox).where(eq(emailOutbox.userId, user.id));
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.template, "welcome");
      assert.equal(rows[0]?.toEmail, user.email);
      assert.equal(rows[0]?.status, "pending");
      assert.match(rows[0]?.html ?? "", /logo-1\.png/);

      await assert.rejects(
        () =>
          db.insert(emailOutbox).values({
            idempotencyKey: `blank-${suffix}`,
            userId: user.id,
            template: "welcome",
            toEmail: "not-an-email",
            subject: "x",
            html: "<p>x</p>",
            bodyText: "x",
          }),
        isCheckViolation,
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("does not double-send on retry, a second dispatch, or two workers", async () => {
    const a = createDb();
    const b = createDb();
    const suffix = randomUUID().slice(0, 8);
    try {
      const user = await insertUser(a.db, suffix);
      const enqueued = await enqueueTransactionalEmail(a.db, {
        userId: user.id,
        toEmail: user.email,
        template: "welcome",
        idempotencyKey: `welcome:user:${user.id}`,
        subject: "Welcome to GitHub Bounties",
        html: "<p>Welcome</p>",
        text: "Welcome",
      });
      assert.equal(enqueued.enqueued, true);

      let calls = 0;
      const flaky: TransactionalEmailProvider = {
        name: "fake",
        async send(message) {
          calls += 1;
          assert.equal(message.to, user.email);
          assert.equal(message.idempotencyKey, `welcome:user:${user.id}`);
          if (calls === 1) return { ok: false, error: "resend_http_500", retryable: true };
          return { ok: true, providerMessageId: "msg_once" };
        },
      };

      const first = await dispatchEmailOutbox({ db: a.db, provider: flaky, userId: user.id });
      assert.equal(first.deferred, 1);
      assert.equal(first.sent, 0);
      const second = await dispatchEmailOutbox({ db: a.db, provider: flaky, userId: user.id });
      assert.equal(second.sent, 1);
      const third = await dispatchEmailOutbox({ db: a.db, provider: flaky, userId: user.id });
      assert.equal(third.claimed, 0);
      assert.equal(calls, 2);

      const [sent] = await a.db.select().from(emailOutbox).where(eq(emailOutbox.userId, user.id));
      assert.equal(sent?.status, "sent");
      assert.equal(sent?.providerMessageId, "msg_once");
      assert.equal(sent?.toEmail, user.email);

      const [other] = await a.db
        .insert(users)
        .values({
          googleSub: `email-outbox-race-${suffix}`,
          email: `race-${suffix}@example.com`,
          displayName: "Race",
        })
        .returning();
      if (!other) throw new Error("race user missing");
      await enqueueTransactionalEmail(a.db, {
        userId: other.id,
        toEmail: other.email,
        template: "welcome",
        idempotencyKey: `welcome:user:${other.id}`,
        subject: "Welcome to GitHub Bounties",
        html: "<p>Welcome</p>",
        text: "Welcome",
      });

      let raceCalls = 0;
      const slow: TransactionalEmailProvider = {
        name: "fake",
        async send(message) {
          raceCalls += 1;
          assert.equal(message.to, other.email);
          await delay(200);
          return { ok: true, providerMessageId: "msg_race" };
        },
      };
      const [left, right] = await Promise.all([
        dispatchEmailOutbox({ db: a.db, provider: slow, workerId: "worker-a", userId: other.id }),
        dispatchEmailOutbox({ db: b.db, provider: slow, workerId: "worker-b", userId: other.id }),
      ]);
      assert.equal(left.sent + right.sent, 1);
      assert.equal(raceCalls, 1);
      const [raced] = await a.db.select().from(emailOutbox).where(eq(emailOutbox.userId, other.id));
      assert.equal(raced?.status, "sent");
    } finally {
      await a.sql.end({ timeout: 5 });
      await b.sql.end({ timeout: 5 });
    }
  });

  it("reclaims a stale sending lease once and then stops at max attempts", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    try {
      const user = await insertUser(db, `lease-${suffix}`);
      await db.insert(emailOutbox).values({
        idempotencyKey: `welcome:user:${user.id}`,
        userId: user.id,
        template: "welcome",
        toEmail: user.email,
        subject: "Welcome to GitHub Bounties",
        html: "<p>Welcome</p>",
        bodyText: "Welcome",
        status: "sending",
        attemptCount: 1,
        lockedAt: new Date(Date.now() - 10 * 60 * 1000),
        lockedBy: "crashed-worker",
      });

      let calls = 0;
      const provider: TransactionalEmailProvider = {
        name: "fake",
        async send() {
          calls += 1;
          return { ok: true, providerMessageId: "msg_lease" };
        },
      };
      const reclaimed = await dispatchEmailOutbox({ db, provider, userId: user.id });
      assert.equal(reclaimed.sent, 1);
      assert.equal(calls, 1);
      const again = await dispatchEmailOutbox({ db, provider, userId: user.id });
      assert.equal(again.claimed, 0);
      assert.equal(calls, 1);

      const limited = await insertUser(db, `max-${suffix}`);
      await db.insert(emailOutbox).values({
        idempotencyKey: `welcome:user:${limited.id}`,
        userId: limited.id,
        template: "welcome",
        toEmail: limited.email,
        subject: "Welcome to GitHub Bounties",
        html: "<p>Welcome</p>",
        bodyText: "Welcome",
        status: "pending",
        attemptCount: EMAIL_OUTBOX_MAX_ATTEMPTS - 1,
      });
      const failing: TransactionalEmailProvider = {
        name: "fake",
        async send() {
          return { ok: false, error: "resend_http_500", retryable: true };
        },
      };
      const exhausted = await dispatchEmailOutbox({ db, provider: failing, userId: limited.id });
      assert.equal(exhausted.failed, 1);
      const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.userId, limited.id));
      assert.equal(row?.status, "failed");
      assert.equal(row?.attemptCount, EMAIL_OUTBOX_MAX_ATTEMPTS);
      const stopped = await dispatchEmailOutbox({
        db,
        provider: {
          name: "fake",
          async send() {
            throw new Error("should not send");
          },
        },
        userId: limited.id,
      });
      assert.equal(stopped.claimed, 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
