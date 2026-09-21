import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ISSUE_BODY_TTL_MS,
  shouldRefreshIssueBody,
  splitFullName,
} from "./issue-body";

describe("issue body refresh", () => {
  const now = new Date("2026-09-21T12:00:00.000Z");

  it("refetches missing, unsynced, truncated, or stale snapshots", () => {
    assert.equal(shouldRefreshIssueBody({ snapshot: null, syncedAt: now, now }), true);
    assert.equal(
      shouldRefreshIssueBody({ snapshot: "hello", syncedAt: null, now }),
      true,
    );
    assert.equal(
      shouldRefreshIssueBody({
        snapshot: `${"x".repeat(3999)}…`,
        syncedAt: now,
        now,
      }),
      true,
    );
    assert.equal(
      shouldRefreshIssueBody({
        snapshot: "full issue body",
        syncedAt: new Date(now.getTime() - ISSUE_BODY_TTL_MS - 1),
        now,
      }),
      true,
    );
    assert.equal(
      shouldRefreshIssueBody({
        snapshot: "full issue body",
        syncedAt: new Date(now.getTime() - 60_000),
        now,
      }),
      false,
    );
  });

  it("splits owner/repo and rejects extra path segments", () => {
    assert.deepEqual(splitFullName("octo/hello"), ["octo", "hello"]);
    assert.deepEqual(splitFullName("octo/hello/extra"), [null, null]);
    assert.deepEqual(splitFullName("octo"), [null, null]);
  });
});
