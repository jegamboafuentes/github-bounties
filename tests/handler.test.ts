import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DeliveryStore } from "../src/delivery-store.js";
import { handleDelivery, wouldMarkLine } from "../src/handler.js";
import type { GitHubWebhookPayload } from "../src/types.js";

const fixture = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../fixtures/pull-request-merged-fixes.json",
    ),
    "utf8",
  ),
) as {
  deliveryId: string;
  event: string;
  payload: GitHubWebhookPayload;
};

describe("handleDelivery", () => {
  it("logs would mark claim eligible on a merged Fixes #N PR", () => {
    const logs: string[] = [];
    const result = handleDelivery({
      deliveryId: fixture.deliveryId,
      event: fixture.event,
      payload: fixture.payload,
      deps: { store: new DeliveryStore(), log: (line) => logs.push(line) },
    });

    assert.equal(result.duplicate, false);
    assert.equal(result.decision?.eligible, true);
    assert.deepEqual(result.decision?.closedIssueNumbers, [42]);
    assert.equal(
      logs.some((line) => line.includes("would mark claim eligible")),
      true,
    );
    assert.match(logs.join("\n"), /issue=#42/);
    assert.match(logs.join("\n"), /winner=octocat/);
  });

  it("does not double-eligibility on the same delivery id", () => {
    const logs: string[] = [];
    const store = new DeliveryStore();
    const deps = { store, log: (line: string) => logs.push(line) };

    const first = handleDelivery({
      deliveryId: fixture.deliveryId,
      event: fixture.event,
      payload: fixture.payload,
      deps,
    });
    const second = handleDelivery({
      deliveryId: fixture.deliveryId,
      event: fixture.event,
      payload: fixture.payload,
      deps,
    });

    const eligibleLines = logs.filter((line) =>
      line.includes("would mark claim eligible"),
    );
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(eligibleLines.length, 1);
    assert.equal(
      logs.filter((line) => line.includes("skip duplicate delivery")).length,
      1,
    );
    assert.equal(
      eligibleLines[0],
      wouldMarkLine({
        deliveryId: fixture.deliveryId,
        decision: first.decision!,
        issueNumber: 42,
      }),
    );
  });

  it("does not log eligibility for a closed-but-unmerged PR", () => {
    const logs: string[] = [];
    const payload: GitHubWebhookPayload = structuredClone(fixture.payload);
    if (payload.pull_request) payload.pull_request.merged = false;
    const result = handleDelivery({
      deliveryId: "unmerged-1",
      event: "pull_request",
      payload,
      deps: { store: new DeliveryStore(), log: (line) => logs.push(line) },
    });
    assert.equal(result.decision?.eligible, false);
    assert.equal(
      logs.some((line) => line.includes("would mark claim eligible")),
      false,
    );
  });
});
