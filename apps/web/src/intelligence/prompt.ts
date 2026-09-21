import type { GitHubRepoContext } from "../github/api";

export const INTELLIGENCE_ESTIMATE_LABEL = "AI estimate — not a guarantee";

export type IntelligencePromptInput = {
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string | null;
  repo: GitHubRepoContext;
};

export type IntelligenceModelOutput = {
  repoAbout: string;
  languageStack: string;
  complexity: "S" | "M" | "L";
};

const COMPLEXITY = new Set(["S", "M", "L"]);

export function buildIntelligencePrompt(input: IntelligencePromptInput): string {
  const body = (input.issueBody ?? "").trim() || "(empty issue body)";
  const languages =
    input.repo.languages.length > 0
      ? input.repo.languages.join(", ")
      : input.repo.language || "(unknown)";
  const about = input.repo.description?.trim() || "(no GitHub about)";
  const readme = input.repo.readmeBlurb?.trim() || "(no README)";

  return `You analyze a GitHub bounty for hunters. Ground every field in the fetched issue body and repo metadata below. Do not invent APIs, files, or requirements that are not supported by that source. If the source is thin, say so.

Return JSON only with keys:
- repoAbout: 1-3 sentences describing what the repository is, from GitHub about + README blurb.
- languageStack: short stack string from the language list (and README if it names frameworks).
- complexity: exactly one of S, M, L for the issue (S=small, M=medium, L=large). Estimate from the issue body, not the whole repo.

Repo: ${input.repoFullName}
Issue: #${input.issueNumber} ${input.issueTitle}

GitHub about:
${about}

Languages (bytes, descending):
${languages}

README blurb:
${readme}

Issue body:
${body}`;
}

export function parseIntelligenceJson(raw: string): IntelligenceModelOutput | null {
  const text = stripFence(raw).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as {
      repoAbout?: unknown;
      languageStack?: unknown;
      complexity?: unknown;
    };
    const repoAbout = stringifyField(parsed.repoAbout);
    const languageStack = stringifyField(parsed.languageStack);
    const complexity = String(parsed.complexity ?? "")
      .trim()
      .toUpperCase();
    if (!repoAbout || !languageStack || !COMPLEXITY.has(complexity)) return null;
    return {
      repoAbout,
      languageStack,
      complexity: complexity as "S" | "M" | "L",
    };
  } catch {
    return null;
  }
}

function stringifyField(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 2000);
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? trimmed;
}
