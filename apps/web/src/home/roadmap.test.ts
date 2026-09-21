import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PUBLIC_ROADMAP,
  ROADMAP_STATUS_LABEL,
  ROADMAP_STATUSES,
  roadmapFocus,
  type RoadmapItem,
} from "./roadmap";

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

  it("keeps public copy current: shipped work done, next items concrete", () => {
    const byId = Object.fromEntries(PUBLIC_ROADMAP.map((item) => [item.id, item]));
    assert.equal(byId.v1?.status, "shipped");
    assert.match(byId.v1?.summary ?? "", /live on production/i);
    assert.equal(byId.v2?.status, "shipped");
    assert.match(byId.v2?.summary ?? "", /15% of post-fee/i);
    assert.doesNotMatch(byId.v2?.summary ?? "", /V2-0|pending Enrique/i);
    assert.equal(byId["pool-claim"]?.status, "shipped");
    assert.match(byId["pool-claim"]?.summary ?? "", /winner \+ fee only/i);
    assert.equal(byId.fe?.status, "shipped");
    assert.match(byId.fe?.summary ?? "", /split pies/i);
    assert.doesNotMatch(byId.fe?.summary ?? "", /FE-2/i);
    assert.equal(byId["v3-0"]?.status, "shipped");
    assert.match(byId["v3-0"]?.summary ?? "", /AI estimates/i);
    assert.match(byId["v3-0"]?.summary ?? "", /live on DEV/i);
    assert.equal(byId["v3-prod"]?.status, "in_progress");
    assert.match(byId["v3-prod"]?.summary ?? "", /production/i);
    assert.match(byId["v3-prod"]?.summary ?? "", /no public date/i);
    assert.equal(byId["hosted-checkout"]?.status, "planned");
    assert.equal(byId["v2-5"], undefined);
    assert.equal(byId["fe-2"], undefined);
  });

  it("lists shipped work before in-progress and planned, with one active phase", () => {
    const statuses = PUBLIC_ROADMAP.map((item) => item.status);
    assert.deepEqual(
      [...statuses].sort((a, b) => rank(a) - rank(b)),
      statuses,
    );
    assert.equal(statuses.filter((status) => status === "in_progress").length, 1);
  });

  it("aims the rail and highlight at the in-progress phase", () => {
    const focus = roadmapFocus();
    assert.equal(focus.activeId, "v3-prod");
    assert.equal(PUBLIC_ROADMAP[focus.activeIndex]?.id, "v3-prod");
    assert.equal(focus.railProgress, 5 / 6);
    assert.equal(roadmapFocus([]).activeId, null);
    assert.equal(roadmapFocus([{ ...loneShipped }]).railProgress, 1);
    assert.equal(roadmapFocus([loneShipped, lonePlanned]).activeId, "only");
  });

  it("keeps docs/roadmap.md in sync with the homepage constant", () => {
    assert.match(docsRoadmap, /Do not invent ship dates/i);
    assert.doesNotMatch(docsRoadmap, /pending Enrique|FE-2|V2-0/i);
    for (const item of PUBLIC_ROADMAP) {
      assert.match(docsRoadmap, new RegExp(item.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});

function rank(status: RoadmapItem["status"]): number {
  if (status === "shipped") return 0;
  if (status === "in_progress") return 1;
  return 2;
}

const loneShipped = {
  id: "only",
  version: "V0",
  title: "Only",
  summary: "Shipped item.",
  status: "shipped",
} as const satisfies RoadmapItem;

const lonePlanned = {
  id: "later",
  version: "Next",
  title: "Later",
  summary: "Planned item.",
  status: "planned",
} as const satisfies RoadmapItem;
