import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Database } from "../db/client";
import { pollHfMerges } from "./hf-merge-poller";

describe("Hugging Face merge poller", () => {
  it("does not query or call the Hub when the flag is off", async () => {
    let calls = 0;
    const db = new Proxy({} as Database, {
      get() {
        throw new Error("database was used while the flag was off");
      },
    });
    const result = await pollHfMerges(db, {
      env: {},
      http: async () => {
        calls += 1;
        throw new Error("hub");
      },
    });
    assert.equal(result.skipped, "hf_disabled");
    assert.equal(result.scanned, 0);
    assert.equal(calls, 0);
  });
});
