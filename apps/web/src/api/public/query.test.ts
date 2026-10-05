import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { listBoardBounties } from "../../bounties/list";
import { PublicApiError } from "./errors";
import { createBountiesMcpServer } from "./mcp";
import type { PublicReadApi } from "./service";
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

  it("accepts a provider filter and rejects any other value", () => {
    const github = acceptListInput(coerceListSearchParams(new URLSearchParams({ provider: "github" })));
    assert.equal(github.provider, "github");
    const huggingface = acceptListInput(
      coerceListSearchParams(new URLSearchParams({ provider: " huggingface " })),
    );
    assert.equal(huggingface.provider, "huggingface");

    assert.throws(
      () => acceptListInput(coerceListSearchParams(new URLSearchParams({ provider: "gitlab" }))),
      (err: unknown) => {
        assert.ok(err instanceof PublicApiError);
        assert.equal(err.code, "validation_failed");
        assert.equal(err.status, 400);
        assert.equal(err.message, "Invalid bounty list query.");
        const details = err.details as { path: string; message: string }[];
        assert.equal(Array.isArray(details), true);
        assert.equal(details.some((item) => item.path === "provider"), true);
        return true;
      },
    );
  });

  it("treats status=all and complexity=all as omitted", () => {
    const parsed = acceptListInput(
      coerceListSearchParams(new URLSearchParams({ status: "all", complexity: "ALL", has_intel: "0" })),
    );
    assert.equal(parsed.status, undefined);
    assert.equal(parsed.complexity, undefined);
    assert.equal(parsed.has_intel, false);
  });

  it("rejects control characters in repo and language before a query", async () => {
    for (const [key, value] of [
      ["repo", "octo/\u0000hello"],
      ["repo", "ab\u0000cd"],
      ["language", "Go\u001F"],
      ["language", "\u007F"],
    ] as const) {
      assert.throws(
        () => acceptListInput(coerceListSearchParams(new URLSearchParams({ [key]: value }))),
        (err: unknown) => {
          assert.ok(err instanceof PublicApiError);
          assert.equal(err.code, "validation_failed");
          assert.equal(err.status, 400);
          assert.equal(err.message, "Invalid bounty list query.");
          const details = err.details as { path: string; message: string }[];
          assert.equal(details[0]?.path, key);
          assert.match(details[0]?.message ?? "", /control characters/);
          return true;
        },
      );
      assert.throws(
        () => acceptListInput({ [key]: value }),
        (err: unknown) => err instanceof PublicApiError && err.code === "validation_failed",
      );
    }
    const parsed = acceptListInput({ repo: "octo/hello", language: "TypeScript" });
    assert.equal(parsed.repo, "octo/hello");
    assert.equal(parsed.language, "TypeScript");

    await assert.rejects(
      () => listBoardBounties({} as never, { repo: "a\u0000b" }),
      (err: unknown) =>
        err instanceof PublicApiError &&
        err.status === 400 &&
        err.message === "Repo cannot include control characters.",
    );
    await assert.rejects(
      () => listBoardBounties({} as never, { language: "\u0000" }),
      (err: unknown) =>
        err instanceof PublicApiError && err.message === "Language cannot include control characters.",
    );

    let queried = false;
    const api: PublicReadApi = {
      async listBounties() {
        queried = true;
        throw new Error("queried");
      },
      async getBounty() {
        throw new Error("unused");
      },
      async listFunders() {
        throw new Error("unused");
      },
      async getIntelligence() {
        throw new Error("unused");
      },
      async getStats() {
        throw new Error("unused");
      },
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createBountiesMcpServer(api);
    const client = new Client({ name: "board", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const denied = await client.callTool({ name: "list_bounties", arguments: { repo: "ab\u0000cd" } });
      assert.equal(denied.isError, true);
      const content = denied.content as Array<{ text?: string }>;
      const body = JSON.parse(content[0]?.text ?? "") as { error: { code: string; message: string } };
      assert.equal(body.error.code, "validation_failed");
      assert.equal(body.error.message, "Invalid bounty list query.");
      assert.equal(queried, false);
    } finally {
      await client.close();
      await server.close();
    }
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
