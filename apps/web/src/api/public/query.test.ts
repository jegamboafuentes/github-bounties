import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptListInput,
  coerceListSearchParams,
  cursorFromPageItem,
  decodeBoardCursor,
  encodeBoardCursor,
} from "./query";

const ID = "00000000-0000-4000-8000-000000000022";

describe("public bounty list query", () => {
  it("defaults limit to 20 and sort to newest", () => {
    const parsed = acceptListInput(coerceListSearchParams(new URLSearchParams()));
    assert.equal(parsed.limit, 20);
    assert.equal(parsed.sort, "newest");
    assert.equal(parsed.cursorValue, null);
    assert.equal(parsed.repo, undefined);
  });

  it("parses filters, has_intel, and clamps the page size", () => {
    const parsed = acceptListInput(
      coerceListSearchParams(
        new URLSearchParams({
          repo: " octo/hello ",
          status: "funded",
          complexity: "m",
          language: " TypeScript ",
          has_intel: "true",
          sort: "amount",
          limit: "100",
        }),
      ),
    );
    assert.equal(parsed.repo, "octo/hello");
    assert.equal(parsed.status, "funded");
    assert.equal(parsed.complexity, "M");
    assert.equal(parsed.language, "TypeScript");
    assert.equal(parsed.has_intel, true);
    assert.equal(parsed.sort, "amount");
    assert.equal(parsed.limit, 100);
  });

  it("treats status=all and complexity=all as omitted", () => {
    const parsed = acceptListInput(
      coerceListSearchParams(new URLSearchParams({ status: "all", complexity: "ALL", has_intel: "0" })),
    );
    assert.equal(parsed.status, undefined);
    assert.equal(parsed.complexity, undefined);
    assert.equal(parsed.has_intel, false);
  });

  it("rejects limit above 100, unknown status, and a bad cursor", () => {
    assert.throws(
      () => acceptListInput(coerceListSearchParams(new URLSearchParams({ limit: "101" }))),
      (err: unknown) => {
        assert.equal((err as { code: string }).code, "validation_failed");
        return true;
      },
    );
    assert.throws(
      () => acceptListInput(coerceListSearchParams(new URLSearchParams({ limit: "0" }))),
      (err: unknown) => (err as { code: string }).code === "validation_failed",
    );
    assert.throws(
      () => acceptListInput(coerceListSearchParams(new URLSearchParams({ status: "open" }))),
      (err: unknown) => (err as { code: string }).code === "validation_failed",
    );
    assert.throws(
      () => acceptListInput(coerceListSearchParams(new URLSearchParams({ cursor: "nope" }))),
      (err: unknown) => (err as { code: string }).code === "validation_failed",
    );
  });

  it("round-trips an opaque keyset cursor and rejects a sort mismatch", () => {
    const newest = encodeBoardCursor({
      v: 1,
      sort: "newest",
      createdAt: "2026-09-01T00:00:00.000Z",
      id: ID,
    });
    const decoded = decodeBoardCursor(newest);
    assert.equal(decoded?.sort, "newest");
    assert.equal(decoded && decoded.sort === "newest" ? decoded.id : "", ID);
    assert.equal(newest.includes("createdAt"), false);

    const parsed = acceptListInput({ cursor: newest, sort: "newest", limit: 2 });
    assert.equal(parsed.cursorValue?.sort, "newest");

    assert.throws(
      () => acceptListInput({ cursor: newest, sort: "amount" }),
      (err: unknown) => (err as { code: string }).code === "validation_failed",
    );

    const next = cursorFromPageItem(
      { id: ID, createdAt: "2026-09-02T00:00:00.000Z", amountUsdc: "40.000000" },
      "amount",
    );
    const amount = decodeBoardCursor(next);
    assert.equal(amount && amount.sort === "amount" ? amount.amount : "", "40.000000");
  });
});
