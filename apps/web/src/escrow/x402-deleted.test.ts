import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleX402Fund } from "./x402-http";

function fakeDb(rows: unknown[][]) {
  let n = 0;
  const chain = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    limit() {
      const page = rows[n] ?? [];
      n += 1;
      return Promise.resolve(page);
    },
  };
  return { select: () => chain };
}

describe("x402 fund on a deleted bounty", () => {
  it("returns 410 and never a 402 when the bounty is soft-deleted", async () => {
    const result = await handleX402Fund(new Request("https://dev.githubbounties.xyz/api/bounties/b/x402"), "b", {
      db: fakeDb([
        [
          {
            id: "b",
            deletedAt: new Date("2026-10-01T20:37:19Z"),
            status: "pending_fund",
            amountUsdc: "10.000000",
          },
        ],
        [{ id: "e", status: "pending", bountyId: "b" }],
      ]) as never,
    });
    assert.equal(result.status, 410);
    assert.notEqual(result.status, 402);
    assert.equal((result.body as { error?: string }).error, "bounty_not_found");
  });

  it("keeps a missing bounty at 404", async () => {
    const result = await handleX402Fund(new Request("https://dev.githubbounties.xyz/api/bounties/missing/x402"), "missing", {
      db: fakeDb([[]]) as never,
    });
    assert.equal(result.status, 404);
  });
});
