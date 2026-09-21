export type BoardIntelligenceBadge = {
  complexity: "S" | "M" | "L";
  languageStack: string;
};

export type BoardIntelligenceFilters = {
  complexity?: string;
  language?: string;
};

export function parseComplexityFilter(raw?: string): "S" | "M" | "L" | undefined {
  const value = raw?.trim().toUpperCase();
  if (value === "S" || value === "M" || value === "L") return value;
  return undefined;
}

export function parseLanguageFilter(raw?: string): string | undefined {
  const value = raw?.trim();
  return value || undefined;
}

export function intelligenceFilterActive(filters: BoardIntelligenceFilters): boolean {
  return Boolean(parseComplexityFilter(filters.complexity) || parseLanguageFilter(filters.language));
}

/** Ready Gemini cache only. Missing / error rows hide the badge (no “unknown”). */
export function readyIntelligenceBadge(row: {
  status?: string | null;
  complexity?: string | null;
  languageStack?: string | null;
}): BoardIntelligenceBadge | null {
  if (row.status !== "ready") return null;
  if (row.complexity !== "S" && row.complexity !== "M" && row.complexity !== "L") {
    return null;
  }
  const languageStack = row.languageStack?.trim() ?? "";
  if (!languageStack) return null;
  return { complexity: row.complexity, languageStack };
}

/**
 * Active complexity/language filters exclude bounties with no ready intel
 * (unmatched / missing cache). Inactive filters keep those rows.
 */
export function matchesBoardIntelligenceFilter(
  badge: BoardIntelligenceBadge | null,
  filters: BoardIntelligenceFilters = {},
): boolean {
  const complexity = parseComplexityFilter(filters.complexity);
  const language = parseLanguageFilter(filters.language)?.toLowerCase();
  if (!complexity && !language) return true;
  if (!badge) return false;
  if (complexity && badge.complexity !== complexity) return false;
  if (language && !badge.languageStack.toLowerCase().includes(language)) return false;
  return true;
}
