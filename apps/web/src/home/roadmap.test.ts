import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { PUBLIC_ROADMAP, ROADMAP_STATUS_LABEL, ROADMAP_STATUSES } from "./roadmap";

const docsRoadmap = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/roadmap.md"),
  "utf8",
);

const STATUS_RANK: Record<(typeof ROADMAP_STATUSES)[number], number> = {
  shipped: 0,
  in_progress: 1,
  planned: 2,
};

describe("public roadmap", () => {
  it("uses honest statuses and never invents a ship date field", () => {
    assert.deepEqual([...ROADMAP_STATUSES], ["shipped", "in_progress", "planned"]);
    assert.equal(ROADMAP_STATUS_LABEL.planned, "Planned");
    assert.equal(ROADMAP_STATUS_LABEL.in_progress, "In progress");
    for (const item of PUBLIC_ROADMAP) {
      assert.ok(ROADMAP_STATUSES.includes(item.status));
      assert.equal("shipDate" in item, false);
      assert.equal("eta" in item, false);
      assert.doesNotMatch(item.summary, /\bQ[1-4]\b|\b20\d{2}-\d{2}-\d{2}\b/);
    }
    const ranks = PUBLIC_ROADMAP.map((item) => STATUS_RANK[item.status]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  });

  it("marks shipped V1–V2 / FE slices and keeps V3-0 DEV-only", () => {
    const byId = Object.fromEntries(PUBLIC_ROADMAP.map((item) => [item.id, item]));
    assert.equal(byId.v1?.status, "shipped");
    assert.equal(byId.v2?.status, "shipped");
    assert.match(byId.v2?.summary ?? "", /dogfood done/i);
    assert.doesNotMatch(byId.v2?.summary ?? "", /pending Enrique/i);
    assert.equal(byId["v2-5"], undefined);
    assert.equal(byId["pool-claim"]?.status, "shipped");
    assert.match(byId["pool-claim"]?.summary ?? "", /#47/);
    assert.match(byId["pool-claim"]?.summary ?? "", /PROD/);
    assert.equal(byId["fe-home"]?.status, "shipped");
    assert.match(byId["fe-home"]?.summary ?? "", /GET \/api\/stats/);
    assert.equal(byId["fe-2"]?.status, "shipped");
    assert.equal(byId["fe-2"]?.version, "FE-2");
    assert.match(byId["fe-2"]?.summary ?? "", /Shipped on bounty pages/i);
    assert.equal(byId["v3-0"]?.status, "in_progress");
    assert.match(byId["v3-0"]?.summary ?? "", /Live on DEV, not PROD/i);
    assert.match(byId["v3-0"]?.summary ?? "", /AI estimates/i);
    assert.match(byId["v3-0"]?.summary ?? "", /DEV pill/i);
    assert.equal(byId["hosted-checkout"]?.status, "planned");
    assert.match(byId["hosted-checkout"]?.summary ?? "", /deferred/i);
    assert.match(byId["hosted-checkout"]?.summary ?? "", /ADR 0001/);
    assert.equal(byId.v4?.status, "planned");
    assert.match(byId.v4?.summary ?? "", /MCP/i);
    assert.equal(byId.v5?.status, "planned");
    assert.match(byId.v5?.summary ?? "", /Agent-native/i);
  });

  it("keeps docs/roadmap.md in sync with the homepage constant", () => {
    assert.match(docsRoadmap, /Do not invent ship dates/i);
    assert.match(docsRoadmap, /as of 2026-09-21/i);
    assert.doesNotMatch(docsRoadmap, /pending Enrique/i);
    for (const item of PUBLIC_ROADMAP) {
      assert.match(docsRoadmap, new RegExp(item.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});
