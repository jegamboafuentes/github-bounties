import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicWorkSignals, type WorkSignalView } from "./signals";

const signal: WorkSignalView = {
  id: "sig-1",
  bountyId: "57ed5628-0000-4000-8000-000000000001",
  userId: "user-1",
  githubLogin: "octocat",
  hunterLabel: "octocat",
  signaledAt: new Date("2026-09-01T00:00:00.000Z"),
};

describe("public work signals", () => {
  it("returns an empty list for a cancelled bounty and keeps signals for other statuses", () => {
    assert.deepEqual(publicWorkSignals("cancelled", [signal]), []);
    assert.deepEqual(publicWorkSignals("funded", [signal]), [signal]);
    assert.deepEqual(publicWorkSignals("expired", [signal]), [signal]);
    assert.deepEqual(publicWorkSignals("refunded", [signal]), [signal]);
  });
});
