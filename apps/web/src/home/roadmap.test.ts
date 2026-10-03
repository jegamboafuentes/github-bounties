import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { PUBLIC_API_VERSION } from "../api/public/version";
import { publicSurfaceCounts, surfaceCountPhrase } from "../api/public/surface-counts";
import {
  PUBLIC_ROADMAP,
  ROADMAP_INTRO,
  roadmapTextSegments,
  roadmapWithSurface,
  ROADMAP_STATUS_LABEL,
  ROADMAP_STATUSES,
} from "./roadmap";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const docsRoadmap = readFileSync(join(repoRoot, "docs/roadmap.md"), "utf8");
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");

const STATUS_RANK: Record<(typeof ROADMAP_STATUSES)[number], number> = {
  shipped: 0,
  in_progress: 1,
  next: 2,
  then: 3,
  later: 4,
  parked: 5,
};

describe("public roadmap", () => {
  it("uses honest statuses and never invents a ship date field", () => {
    assert.deepEqual([...ROADMAP_STATUSES], ["shipped", "in_progress", "next", "then", "later", "parked"]);
    assert.equal(ROADMAP_STATUS_LABEL.shipped, "Shipped");
    assert.equal(ROADMAP_STATUS_LABEL.in_progress, "In progress");
    assert.equal(ROADMAP_STATUS_LABEL.next, "Next");
    assert.equal(ROADMAP_STATUS_LABEL.then, "Then");
    assert.equal(ROADMAP_STATUS_LABEL.later, "Later");
    assert.equal(ROADMAP_STATUS_LABEL.parked, "Parked");
    for (const item of PUBLIC_ROADMAP) {
      assert.ok(ROADMAP_STATUSES.includes(item.status));
      assert.equal("shipDate" in item, false);
      assert.equal("eta" in item, false);
      assert.doesNotMatch(item.summary, /\bQ[1-4]\b/);
      if (item.status !== "shipped") {
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
    assert.match(byId.v2?.summary ?? "", /LIVE on PROD 2026-09-19/);
    assert.match(byId.v2?.summary ?? "", /githubbounties\.xyz/);
    assert.match(byId.v2?.summary ?? "", /Base mainnet USDC/);
    assert.doesNotMatch(byId.v2?.summary ?? "", /pending Enrique/i);
    assert.equal(byId["v2-5"], undefined);
    assert.equal(byId["pool-claim"]?.status, "shipped");
    assert.match(byId["pool-claim"]?.summary ?? "", /LIVE on PROD 2026-09-20/);
    assert.match(byId["pool-claim"]?.summary ?? "", /#47/);
    assert.equal(byId["fe-home"]?.status, "shipped");
    assert.equal(byId["fe-home"]?.title, "FE epic");
    assert.match(byId["fe-home"]?.summary ?? "", /LIVE on PROD 2026-09-20/);
    assert.match(byId["fe-home"]?.summary ?? "", /GET \/api\/stats/);
    assert.equal(byId["fe-2"], undefined);
    assert.equal(byId["v3-0"]?.status, "shipped");
    assert.equal(byId["v3-0"]?.title, "V3 wave");
    assert.match(byId["v3-0"]?.summary ?? "", /LIVE on PROD 2026-09-21/);
    assert.doesNotMatch(byId["v3-0"]?.summary ?? "", /Live on DEV, not PROD/i);
    assert.doesNotMatch(byId["v3-0"]?.summary ?? "", /in_progress/i);
    assert.match(byId["v3-0"]?.summary ?? "", /AI estimates/i);
    assert.match(byId["v3-0"]?.summary ?? "", /board badges\/filters/i);
    assert.match(byId["v3-0"]?.summary ?? "", /Settings\/Post connected-only/i);
    assert.match(byId["v3-0"]?.summary ?? "", /homepage motion/i);
    assert.equal(byId["funding-wave"]?.status, "shipped");
    assert.equal(byId["funding-wave"]?.title, "Funding wave");
    assert.match(byId["funding-wave"]?.summary ?? "", /LIVE on PROD 2026-09-24/);
    assert.match(byId["funding-wave"]?.summary ?? "", /#61/);
    assert.match(byId["funding-wave"]?.summary ?? "", /#64/);
    assert.match(byId["funding-wave"]?.summary ?? "", /#65 to #67/);
    assert.match(byId["funding-wave"]?.summary ?? "", /USDC top-ups on already-funded bounties/);
    assert.match(byId["funding-wave"]?.summary ?? "", /without installing the GitHub App/);
    assert.match(byId["funding-wave"]?.summary ?? "", /public merge poller/);
    assert.match(byId["funding-wave"]?.summary ?? "", /Funder avatars/);
    assert.match(byId["funding-wave"]?.summary ?? "", /Funders list/);
    assert.equal(byId.v4?.status, "shipped");
    assert.equal(byId.v4?.title, "API + MCP");
    assert.equal(byId.v4?.href, "/mcp");
    assert.match(byId.v4?.summary ?? "", /LIVE on PROD 2026-09-25/);
    assert.match(byId.v4?.summary ?? "", /PROD serves 4\.5\.0/);
    assert.match(
      byId.v4?.summary ?? "",
      new RegExp(`${PUBLIC_API_VERSION.replace(/\./g, "\\.")} is the DEV and main API version`),
    );
    assert.match(byId.v4?.summary ?? "", /adds the provider field/);
    assert.doesNotMatch(
      byId.v4?.summary ?? "",
      new RegExp(`version ${PUBLIC_API_VERSION.replace(/\./g, "\\.")}`),
    );
    assert.doesNotMatch(byId.v4?.summary ?? "", /23 operations, 24 tools/);
    assert.match(byId.v4?.summary ?? "", /API money is OFF on PROD/);
    assert.doesNotMatch(byId.v4?.summary ?? "", /In planning/);
    assert.equal(byId.v5?.status, "shipped");
    assert.equal(byId.v5?.version, "V5");
    assert.equal(byId.v5?.title, "MCP page, unfunded edits, admin");
    assert.match(byId.v5?.summary ?? "", /DONE/);
    assert.match(byId.v5?.summary ?? "", /\/mcp is the MCP server endpoint and its docs page/);
    assert.match(byId.v5?.summary ?? "", /update_bounty_amount/);
    assert.match(byId.v5?.summary ?? "", /ADMIN_REFUND_ENABLED/);
    assert.match(byId.v5?.summary ?? "", /ADMIN_WITHDRAW_ENABLED/);
    assert.match(byId.v5?.summary ?? "", /single-use confirm token and a duplicate guard/);
    assert.match(byId.v5?.summary ?? "", /admin audit log/);
    assert.match(byId.v5?.summary ?? "", /No recorded PROD date/);
    assert.doesNotMatch(byId.v5?.summary ?? "", /Nothing is built/);
    assert.doesNotMatch(byId.v5?.summary ?? "", /LIVE on PROD/);
    assert.equal(byId.v6?.status, "in_progress");
    assert.equal(byId.v6?.version, "V6");
    assert.equal(byId.v6?.title, "Hugging Face");
    assert.match(byId.v6?.summary ?? "", /Bounties on Hugging Face discussions and PRs/);
    assert.match(byId.v6?.summary ?? "", /In progress/);
    assert.match(byId.v6?.summary ?? "", /No ship date/);
    assert.equal(byId.v7?.status, "next");
    assert.equal(byId.v7?.version, "V7");
    assert.equal(byId.v7?.title, "/bounty command");
    assert.match(byId.v7?.summary ?? "", /`\/bounty`/);
    assert.deepEqual(
      roadmapTextSegments(byId.v7?.summary ?? "").filter((segment) => segment.kind === "code"),
      [{ kind: "code", text: "/bounty" }],
    );
    assert.match(byId.v7?.summary ?? "", /GitHub and Hugging Face/);
    assert.match(byId.v7?.summary ?? "", /Nothing is built/);
    assert.equal(byId.v8?.status, "then");
    assert.equal(byId.v8?.version, "V8");
    assert.equal(byId.v8?.title, "Agent economy");
    assert.match(byId.v8?.summary ?? "", /agent economy on x402/i);
    assert.match(byId.v8?.summary ?? "", /No ship date/);
    assert.deepEqual(
      PUBLIC_ROADMAP.map((item) => item.version),
      ["V1", "V2", "Pool Claim", "FE", "V3", "Funding", "V4", "V5", "V6", "V7", "V8", "BTC", "Checkout"],
    );
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
    assert.match(docsRoadmap, /as of 2026-10-03/i);
    assert.doesNotMatch(docsRoadmap, /pending Enrique/i);
    assert.match(docsRoadmap, /LIVE on PROD 2026-09-25/);
    assert.match(docsRoadmap, /LIVE on PROD 2026-09-24/);
    assert.doesNotMatch(docsRoadmap, /Live on DEV, not PROD/i);
    assert.match(docsRoadmap, /## In progress/);
    assert.doesNotMatch(docsRoadmap, /## Planned/i);
    assert.doesNotMatch(docsRoadmap, /In planning/);
    assert.match(docsRoadmap, /## Shipped/);
    assert.match(docsRoadmap, /## Next/);
    assert.match(docsRoadmap, /## Then/);
    assert.match(docsRoadmap, /## Parked/);
    assert.match(docsRoadmap, /githubbounties\.xyz\/mcp/);
    assert.doesNotMatch(docsRoadmap, /\/developers/);
    assert.match(readme, /As of \*\*2026-10-03\*\*/);
    assert.match(readme, /LIVE on PROD 2026-09-25/);
    assert.match(readme, /LIVE on PROD 2026-09-24/);
    assert.match(readme, /githubbounties\.xyz\/mcp/);
    assert.match(readme, /0015_fee_withdraw_guards/);
    assert.match(readme, /ADMIN_EMAILS/);
    assert.match(readme, /ADMIN_REFUND_ENABLED/);
    assert.match(readme, /ADMIN_WITHDRAW_ENABLED/);
    assert.match(readme, /FEE_WALLET_ADDRESS/);
    assert.doesNotMatch(readme, /\/developers/);
    assert.doesNotMatch(readme, /V3-0 is \*\*DEV only\*\*/);
    assert.doesNotMatch(readme, /V3 is not on PROD/);
    assert.doesNotMatch(readme, /V5 agent economy/);
    const docsOrder = ["### V5 —", "## In progress", "### V6 —", "### V7 —", "### V8 —", "## Parked", "### BTC payouts", "### Hosted Coinbase checkout"];
    const readmeOrder = ["**V5 —", "### In progress", "**V6 —", "**V7 —", "**V8 —", "### Parked", "**BTC payouts.**", "**Hosted Coinbase checkout.**"];
    let docsAt = -1;
    for (const marker of docsOrder) {
      const at = docsRoadmap.indexOf(marker);
      assert.ok(at > docsAt, marker);
      docsAt = at;
    }
    let readmeAt = -1;
    for (const marker of readmeOrder) {
      const at = readme.indexOf(marker);
      assert.ok(at > readmeAt, marker);
      readmeAt = at;
    }
    for (const item of PUBLIC_ROADMAP) {
      const title = new RegExp(item.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      assert.match(docsRoadmap, title);
      assert.match(readme, title);
    }
  });

  it("prints live OpenAPI and MCP counts on the roadmap, docs, and README", async () => {
    const counts = await publicSurfaceCounts();
    const phrase = surfaceCountPhrase(counts);
    assert.ok(counts.operations > 23, String(counts.operations));
    assert.ok(counts.tools > 24, String(counts.tools));
    const surfaced = roadmapWithSurface(counts).find((item) => item.id === "v4");
    assert.match(surfaced?.summary ?? "", new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(surfaced?.summary ?? "", new RegExp(PUBLIC_API_VERSION.replace(/\./g, "\\.")));
    assert.match(docsRoadmap, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(readme, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const version = PUBLIC_API_VERSION.replace(/\./g, "\\.");
    assert.match(docsRoadmap, /PROD serves 4\.5\.0/);
    assert.match(readme, /PROD serves 4\.5\.0/);
    assert.match(docsRoadmap, new RegExp(`${version} is the DEV and main API version`));
    assert.match(readme, new RegExp(`${version} is the DEV and main API version`));
    assert.doesNotMatch(docsRoadmap, new RegExp(`version ${version}`));
    assert.doesNotMatch(readme, new RegExp(`version ${version}`));
    assert.doesNotMatch(docsRoadmap, /23 operations, 24 tools/);
    assert.doesNotMatch(readme, /23 operations, 24 tools/);
  });
});
