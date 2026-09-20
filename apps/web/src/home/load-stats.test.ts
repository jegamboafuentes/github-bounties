import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyHomepageStats } from "./load-stats";

describe("homepage stats loader", () => {
  it("falls back to empty FE-0 zeros when the database is unavailable", () => {
    const source = emptyHomepageStats();
    assert.equal(source.live, false);
    assert.equal(source.stats.ok, true);
    assert.equal(source.stats.bounties.total, 0);
    assert.equal(source.stats.volumeUsdc.transacted, "0.000000");
    assert.equal(source.stats.developers.participated, 0);
    assert.equal(source.stats.repos.connected, 0);
  });
});
