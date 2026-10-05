import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listAdminBounties } from "./bounties";
import { isAdminError } from "./errors";

describe("admin bounty search", () => {
  it("rejects control characters before querying Postgres", async () => {
    const db = {
      select() {
        throw new Error("queried");
      },
    };
    for (const search of ["\u0000", "ab\u0000cd", "\u001F", "\u007F"]) {
      await assert.rejects(
        () => listAdminBounties(db as never, { search }),
        (err: unknown) => {
          assert.equal(isAdminError(err), true);
          if (!isAdminError(err)) return false;
          assert.equal(err.status, 400);
          assert.equal(err.code, "validation_failed");
          assert.equal(err.message, "Search cannot include control characters.");
          return true;
        },
      );
    }
  });
});
