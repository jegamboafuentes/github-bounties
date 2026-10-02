import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdminError } from "./errors";
import { adminRefundBounty, adminRefundEnabled } from "./refund";

const BOUNTY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const MISSING = "00000000-0000-4000-8000-000000000099";

function bountyRow(patch?: { deletedAt?: Date | null; status?: string }) {
  return {
    id: BOUNTY,
    posterUserId: "00000000-0000-4000-8000-000000000001",
    status: patch?.status ?? "funded",
    deletedAt: patch?.deletedAt ?? null,
  };
}

function memoryDb(row: Record<string, unknown> | null) {
  const audits: Record<string, unknown>[] = [];
  let selects = 0;
  const db = {
    audits,
    selects: () => selects,
    select() {
      selects += 1;
      const current = selects;
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  if (current > 1) return Promise.reject(new Error("reached-existing-refund"));
                  return Promise.resolve(row ? [row] : []);
                },
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        values(value: Record<string, unknown>) {
          const saved = { id: `audit-${audits.length + 1}`, ...value };
          audits.push(saved);
          return {
            returning() {
              return Promise.resolve([{ id: saved.id }]);
            },
          };
        },
      };
    },
  };
  return db;
}

function codeOf(err: unknown): { status: number; code: string } {
  assert.ok(err instanceof AdminError);
  return { status: err.status, code: err.code };
}

describe("admin refund flag", () => {
  it("is on only when ADMIN_REFUND_ENABLED is exactly 1", () => {
    assert.equal(adminRefundEnabled({}), false);
    assert.equal(adminRefundEnabled({ API_MONEY_ENABLED: "1" }), false);
    assert.equal(adminRefundEnabled({ ADMIN_REFUND_ENABLED: "true", API_MONEY_ENABLED: "1" }), false);
    assert.equal(adminRefundEnabled({ ADMIN_REFUND_ENABLED: "0", API_MONEY_ENABLED: "0" }), false);
    assert.equal(adminRefundEnabled({ ADMIN_REFUND_ENABLED: "1", API_MONEY_ENABLED: "0" }), true);
  });

  it("404s a bad or missing id before the flag and writes no audit", async () => {
    const missing = memoryDb(null);
    await assert.rejects(
      () =>
        adminRefundBounty({
          bountyId: "not-a-uuid",
          actorEmail: "Ada@Example.com",
          db: missing as never,
          env: { ADMIN_REFUND_ENABLED: "0", API_MONEY_ENABLED: "0" },
        }),
      (err: unknown) => codeOf(err).status === 404 && codeOf(err).code === "not_found",
    );
    assert.equal(missing.selects(), 0);
    assert.equal(missing.audits.length, 0);

    await assert.rejects(
      () =>
        adminRefundBounty({
          bountyId: MISSING,
          actorEmail: "ada@example.com",
          db: missing as never,
          env: { ADMIN_REFUND_ENABLED: "0" },
        }),
      (err: unknown) => codeOf(err).status === 404 && codeOf(err).code === "not_found",
    );
    assert.equal(missing.selects(), 1);
    assert.equal(missing.audits.length, 0);
  });

  it("returns 410 for a deleted bounty before the admin flag, with a deleted reason", async () => {
    const db = memoryDb(bountyRow({ deletedAt: new Date("2026-10-01T00:00:00.000Z") }));
    await assert.rejects(
      () =>
        adminRefundBounty({
          bountyId: BOUNTY,
          actorEmail: "Ada@Example.com",
          db: db as never,
          env: { ADMIN_REFUND_ENABLED: "0", API_MONEY_ENABLED: "1" },
        }),
      (err: unknown) => codeOf(err).status === 410 && codeOf(err).code === "not_found",
    );
    assert.equal(db.audits.length, 1);
    assert.equal(db.audits[0]?.result, "refused");
    assert.equal(db.audits[0]?.actorEmail, "ada@example.com");
    assert.equal((db.audits[0]?.after as { reason?: string }).reason, "deleted");
  });

  it("refuses a live bounty with admin_refund_disabled and does not enter the refund flow", async () => {
    const db = memoryDb(bountyRow());
    await assert.rejects(
      () =>
        adminRefundBounty({
          bountyId: BOUNTY,
          actorEmail: "ada@example.com",
          db: db as never,
          env: { ADMIN_REFUND_ENABLED: "0", API_MONEY_ENABLED: "1" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AdminError);
        assert.equal(err.status, 403);
        assert.equal(err.code, "admin_refund_disabled");
        return true;
      },
    );
    assert.equal(db.selects(), 1);
    assert.equal(db.audits.length, 1);
    assert.equal((db.audits[0]?.after as { reason?: string }).reason, "admin_refund_disabled");
  });

  it("reaches the existing refund flow when the admin flag is on and public money is off", async () => {
    const db = memoryDb(bountyRow());
    await assert.rejects(
      () =>
        adminRefundBounty({
          bountyId: BOUNTY,
          actorEmail: "ada@example.com",
          db: db as never,
          env: { ADMIN_REFUND_ENABLED: "1", API_MONEY_ENABLED: "0" },
        }),
      (err: unknown) => err instanceof Error && err.message === "reached-existing-refund",
    );
    assert.equal(db.selects(), 2);
    assert.equal(db.audits.length, 0);
  });
});
