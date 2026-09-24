import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  intelligenceFilterActive,
  matchesBoardIntelligenceFilter,
  matchesListIntelligenceFilter,
  parseComplexityFilter,
  readyIntelligenceBadge,
} from "./intelligence";

describe("board intelligence badges + filters", () => {
  const ready = readyIntelligenceBadge({
    status: "ready",
    complexity: "M",
    languageStack: "TypeScript, Next.js",
  });

  it("builds a badge only for ready S/M/L rows with a stack", () => {
    assert.deepEqual(ready, { complexity: "M", languageStack: "TypeScript, Next.js" });
    assert.equal(
      readyIntelligenceBadge({ status: "error", complexity: "S", languageStack: "Go" }),
      null,
    );
    assert.equal(
      readyIntelligenceBadge({ status: "ready", complexity: "S", languageStack: "  " }),
      null,
    );
    assert.equal(
      readyIntelligenceBadge({ status: "ready", complexity: "XL", languageStack: "Go" }),
      null,
    );
    assert.equal(readyIntelligenceBadge({}), null);
  });

  it("keeps missing intel on the unfiltered board and excludes it when a filter is on", () => {
    assert.equal(intelligenceFilterActive({}), false);
    assert.equal(intelligenceFilterActive({ complexity: "all", language: "" }), false);
    assert.equal(parseComplexityFilter("all"), undefined);
    assert.equal(matchesBoardIntelligenceFilter(null, {}), true);
    assert.equal(matchesBoardIntelligenceFilter(null, { complexity: "S" }), false);
    assert.equal(matchesBoardIntelligenceFilter(null, { language: "Go" }), false);
    assert.equal(matchesBoardIntelligenceFilter(ready, { complexity: "M" }), true);
    assert.equal(matchesBoardIntelligenceFilter(ready, { complexity: "S" }), false);
    assert.equal(matchesBoardIntelligenceFilter(ready, { language: "typescript" }), true);
    assert.equal(matchesBoardIntelligenceFilter(ready, { language: "Go" }), false);
  });

  it("has_intel keeps or drops a ready badge without changing complexity rules", () => {
    assert.equal(matchesListIntelligenceFilter(ready, { hasIntel: true }), true);
    assert.equal(matchesListIntelligenceFilter(null, { hasIntel: true }), false);
    assert.equal(matchesListIntelligenceFilter(null, { hasIntel: false }), true);
    assert.equal(matchesListIntelligenceFilter(ready, { hasIntel: false }), false);
    assert.equal(matchesListIntelligenceFilter(ready, { hasIntel: true, complexity: "M" }), true);
    assert.equal(matchesListIntelligenceFilter(ready, { hasIntel: false, complexity: "M" }), false);
    assert.equal(matchesListIntelligenceFilter(null, {}), true);
  });
});
