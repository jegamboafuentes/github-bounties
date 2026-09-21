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
  });

  it("marks V2-5 as in progress and V3+ slices as planned", () => {
    const byId = Object.fromEntries(PUBLIC_ROADMAP.map((item) => [item.id, item]));
    assert.equal(byId.v1?.status, "shipped");
    assert.equal(byId.v2?.status, "shipped");
    assert.equal(byId["v2-5"]?.status, "in_progress");
    assert.match(byId["v2-5"]?.summary ?? "", /no public ship date/i);
    assert.equal(byId["v3-0"]?.status, "in_progress");
    assert.match(byId["v3-0"]?.summary ?? "", /AI estimates/i);
    assert.equal(byId["fe-2"]?.status, "planned");
    assert.equal(byId["fe-2"]?.version, "V3+");
    assert.equal(byId["hosted-checkout"]?.status, "planned");
    assert.equal(byId["pool-claim"]?.status, "shipped");
    assert.match(byId["pool-claim"]?.summary ?? "", /winner \+ fee only/i);
  });

  it("keeps docs/roadmap.md in sync with the homepage constant", () => {
    assert.match(docsRoadmap, /Do not invent ship dates/i);
    for (const item of PUBLIC_ROADMAP) {
      assert.match(docsRoadmap, new RegExp(item.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});
