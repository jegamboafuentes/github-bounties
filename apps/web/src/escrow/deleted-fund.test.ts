import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fundBounty } from "../bounties/fund";
import { bountyGoneError, rejectIfBountyDeleted } from "./deleted";
import { isEscrowError } from "./errors";
import { httpStatusForEscrowError, jsonForUnknown } from "./http";
import { lockEscrowFunds } from "./service";

const ID = "00000000-0000-4000-8000-0000000000aa";

function deletedDb() {
  let reads = 0;
  const chain = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    limit() {
      reads += 1;
      if (reads > 1) throw new Error("Failed query: select escrows.fund_tx_hash from escrows");
      return Promise.resolve([{ deletedAt: new Date("2026-10-01T20:37:19Z") }]);
    },
  };
  return {
    select: () => chain,
    reads: () => reads,
  };
}

describe("deleted bounty fund and lock", () => {
  it("rejects a deleted bounty before any fund-hash read", async () => {
    const db = deletedDb();
    await assert.rejects(
      () => rejectIfBountyDeleted(db as never, ID),
      (err: unknown) => isEscrowError(err) && err.httpStatus === 410 && err.code === "bounty_not_found",
    );
    assert.equal(db.reads(), 1);
    assert.equal(httpStatusForEscrowError(bountyGoneError()), 410);
  });

  it("fund checks deleted before the lock hash", async () => {
    const db = deletedDb();
    await assert.rejects(
      () => fundBounty(ID, "user-1", db as never, new Date(), { fundTxHash: "0xdead" }),
      (err: unknown) => isEscrowError(err) && err.httpStatus === 410,
    );
    assert.equal(db.reads(), 1);
  });

  it("lock checks deleted before the lock hash", async () => {
    const db = deletedDb();
    await assert.rejects(
      () => lockEscrowFunds(ID, "user-1", { db: db as never, fundTxHash: "0xdead" }),
      (err: unknown) => isEscrowError(err) && err.httpStatus === 410 && err.code === "bounty_not_found",
    );
    assert.equal(db.reads(), 1);
  });

  it("does not copy SQL text into an unknown API error", () => {
    const body = jsonForUnknown("Failed query: select id from bounties where id = $1");
    const text = JSON.stringify(body);
    assert.equal(body.error, "internal");
    assert.equal(body.message, "Request failed.");
    assert.doesNotMatch(text, /Failed query|select /i);
  });
});
