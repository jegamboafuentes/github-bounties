import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DeliveryStore } from "../src/delivery-store.js";

describe("DeliveryStore", () => {
  it("inserts once per delivery id in memory", () => {
    const store = new DeliveryStore();
    const entry = {
      deliveryId: "d1",
      receivedAt: "2026-09-09T00:00:00.000Z",
      event: "pull_request",
    };
    assert.equal(store.recordIfNew(entry), true);
    assert.equal(store.recordIfNew({ ...entry, event: "issues" }), false);
    assert.equal(store.get("d1")?.event, "pull_request");
    assert.equal(store.size(), 1);
  });

  it("persists to a file and reloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "gb-deliveries-"));
    const filePath = join(dir, "deliveries.json");
    const first = new DeliveryStore(filePath);
    assert.equal(
      first.recordIfNew({
        deliveryId: "guid-1",
        receivedAt: "2026-09-09T00:00:00.000Z",
        event: "ping",
      }),
      true,
    );
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
      deliveries: Record<string, { event: string }>;
    };
    assert.equal(raw.deliveries["guid-1"]?.event, "ping");

    const second = new DeliveryStore(filePath);
    assert.equal(second.has("guid-1"), true);
    assert.equal(
      second.recordIfNew({
        deliveryId: "guid-1",
        receivedAt: "2026-09-09T00:00:01.000Z",
        event: "ping",
      }),
      false,
    );
  });
});
