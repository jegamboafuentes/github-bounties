import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { PUBLIC_ROADMAP, ROADMAP_INTRO, ROADMAP_STATUS_LABEL, ROADMAP_STATUSES } from "./roadmap";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const docsRoadmap = readFileSync(join(repoRoot, "docs/roadmap.md"), "utf8");
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");

const STATUS_RANK: Record<(typeof ROADMAP_STATUSES)[number], number> = {
  shipped: 0,
  next: 1,
  then: 2,
  later: 3,
  parked: 4,
};

describe("public roadmap", () => {
  it("uses honest statuses and never invents a ship date field", () => {
    assert.deepEqual([...ROADMAP_STATUSES], ["shipped", "next", "then", "later", "parked"]);
    assert.equal(ROADMAP_STATUS_LABEL.shipped, "Shipped");
    assert.equal(ROADMAP_STATUS_LABEL.next, "Next");
    assert.equal(ROADMAP_STATUS_LABEL.then, "Then");
    assert.equal(ROADMAP_STATUS_LABEL.later, "Later");
    assert.equal(ROADMAP_STATUS_LABEL.parked, "Parked");
    for (const item of PUBLIC_ROADMAP) {
      assert.ok(ROADMAP_STATUSES.includes(item.status));
      assert.equal("shipDate" in item, false);
      assert.equal("eta" in item, false);
      assert.doesNotMatch(item.summary, /\bQ[1-4]\b/);
      if (item.id !== "funding-wave") {
        assert.doesNotMatch(item.summary, /\b20\d{2}-\d{2}-\d{2}\b/);
      }
    }
    const ranks = PUBLIC_ROADMAP.map((item) => STATUS_RANK[item.status]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  });

  it("marks shipped V1–V3 and Funding wave, then next / then / later / parked", () => {
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
    assert.equal(byId["v3-0"]?.status, "shipped");
    assert.match(byId["v3-0"]?.summary ?? "", /Shipped on PROD/i);
    assert.doesNotMatch(byId["v3-0"]?.summary ?? "", /Live on DEV, not PROD/i);
    assert.doesNotMatch(byId["v3-0"]?.summary ?? "", /in_progress/i);
    assert.match(byId["v3-0"]?.summary ?? "", /AI estimates/i);
    assert.match(byId["v3-0"]?.summary ?? "", /board badges\/filters/i);
    assert.match(byId["v3-0"]?.summary ?? "", /Settings\/Post connected-only/i);
    assert.match(byId["v3-0"]?.summary ?? "", /homepage motion/i);
    assert.equal(byId["funding-wave"]?.status, "shipped");
    assert.equal(byId["funding-wave"]?.title, "Funding wave");
    assert.match(byId["funding-wave"]?.summary ?? "", /LIVE on PROD 2026-09-24/);
    assert.match(byId["funding-wave"]?.summary ?? "", /USDC top-ups on already-funded bounties/);
    assert.match(byId["funding-wave"]?.summary ?? "", /without installing the GitHub App/);
    assert.match(byId["funding-wave"]?.summary ?? "", /public merge poller/);
    assert.match(byId["funding-wave"]?.summary ?? "", /Funder avatars/);
    assert.match(byId["funding-wave"]?.summary ?? "", /Funders list/);
    assert.equal(byId.v4?.status, "next");
    assert.equal(byId.v4?.title, "API + MCP");
    assert.match(byId.v4?.summary ?? "", /In planning/);
    assert.match(byId.v4?.summary ?? "", /OpenAPI\/Swagger/);
    assert.match(byId.v4?.summary ?? "", /Cursor, Claude, and ChatGPT/);
    assert.equal(byId.v5?.status, "then");
    assert.equal(byId.v5?.title, "GitHub-native /bounty");
    assert.match(byId.v5?.summary ?? "", /\/bounty <amount>/);
    assert.match(byId.v5?.summary ?? "", /USDC only/);
    assert.match(byId.v5?.summary ?? "", /GitHub App required/);
    assert.equal(byId.v6?.status, "later");
    assert.match(byId.v6?.summary ?? "", /hunt and fund bounties over x402/);
    assert.equal(byId["btc-payouts"]?.status, "parked");
    assert.match(byId["btc-payouts"]?.summary ?? "", /Parked/);
    assert.equal(byId["hosted-checkout"]?.status, "parked");
    assert.match(byId["hosted-checkout"]?.summary ?? "", /Parked/);
    assert.match(byId["hosted-checkout"]?.summary ?? "", /ADR 0001/);
    for (const item of PUBLIC_ROADMAP) {
      if (item.status === "shipped") continue;
      assert.doesNotMatch(`${item.title} ${item.summary}`, /crowdfund|fund any open public/i);
    }
  });

  it("keeps docs/roadmap.md in sync with the public roadmap constant", () => {
    assert.match(ROADMAP_INTRO, /No invented ship dates/);
    assert.doesNotMatch(ROADMAP_INTRO, /\bQ[1-4]\b|\b20\d{2}-\d{2}-\d{2}\b/);
    assert.match(docsRoadmap, /Do not invent ship dates/i);
    assert.match(docsRoadmap, /public `\/roadmap` page/);
    assert.match(docsRoadmap, /as of 2026-09-24/i);
    assert.doesNotMatch(docsRoadmap, /pending Enrique/i);
    assert.match(docsRoadmap, /Shipped on PROD/i);
    assert.match(docsRoadmap, /LIVE on PROD 2026-09-24/);
    assert.doesNotMatch(docsRoadmap, /Live on DEV, not PROD/i);
    assert.doesNotMatch(docsRoadmap, /## In progress/i);
    assert.doesNotMatch(docsRoadmap, /## Planned/i);
    assert.match(docsRoadmap, /## Shipped/);
    assert.match(docsRoadmap, /## Next/);
    assert.match(docsRoadmap, /## Then/);
    assert.match(docsRoadmap, /## Later/);
    assert.match(docsRoadmap, /## Parked/);
    assert.match(readme, /As of \*\*2026-09-24\*\*/);
    assert.match(readme, /LIVE on PROD 2026-09-24/);
    assert.doesNotMatch(readme, /V3-0 is \*\*DEV only\*\*/);
    assert.doesNotMatch(readme, /V3 is not on PROD/);
    assert.doesNotMatch(readme, /V5 agent economy/);
    for (const item of PUBLIC_ROADMAP) {
      const title = new RegExp(item.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      assert.match(docsRoadmap, title);
      assert.match(readme, title);
    }
  });
});
