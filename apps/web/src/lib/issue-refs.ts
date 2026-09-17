/**
 * Pool “references #N” (ADR 0003) — broader than V1 winner closing keywords.
 *
 * Counts, against **this** repository:
 * - Closing keywords in title, body, commits (`Fixes` / `Closes` / `Resolves`)
 * - Non-closing: `Refs #N`, `Related to #N`, `See #N` (optional colon; same-repo
 *   `owner/repo#N` and issue URLs)
 * - Bare `#N` / same-repo URL in the **PR title**
 * - GraphQL `closingIssuesReferences` / Development sidebar numbers
 *
 * Does **not** count: `Duplicate of #N` only; cross-repo `owner/other#N`.
 * Known GitHub negation false-positive (`must NOT close #N`) still matches.
 *
 * V2-0 spike: pure string matching. No GitHub API.
 */

import { closingIssueNumbersForRepo } from "../webhooks/closing-keywords";

export type IssueRef = {
  issueNumber: number;
  /** Undefined means same-repository shorthand `#N`. */
  repoFullName?: string;
};

const TARGET = String.raw`(?:https://github\.com/(?<urlRepo>[^/\s]+/[^/\s]+)/(?:issues|pull)/(?<urlN>\d+)|(?<shortRepo>[^/\s#]+/[^/\s#]+)#(?<shortN>\d+)|#(?<hashN>\d+))`;

const NON_CLOSING_REF = new RegExp(
  String.raw`(^|[^A-Za-z])(?:refs?|related\s+to|see)\s*:?\s+${TARGET}`,
  "gi",
);

const BARE_TARGET = new RegExp(
  String.raw`(^|[^A-Za-z0-9/])${TARGET}`,
  "gi",
);

const DUPLICATE_OF = new RegExp(String.raw`duplicate\s+of\s+${TARGET}`, "gi");

export function parseIssueTarget(
  groups: Record<string, string | undefined> | undefined,
): IssueRef | null {
  if (!groups) return null;
  if (groups.urlRepo && groups.urlN) {
    return { issueNumber: Number(groups.urlN), repoFullName: groups.urlRepo };
  }
  if (groups.shortRepo && groups.shortN) {
    return { issueNumber: Number(groups.shortN), repoFullName: groups.shortRepo };
  }
  if (groups.hashN) {
    return { issueNumber: Number(groups.hashN) };
  }
  return null;
}

function wantedRepo(repositoryFullName: string): string {
  return repositoryFullName.toLowerCase();
}

function countsForRepo(ref: IssueRef, repositoryFullName: string): boolean {
  if (!Number.isInteger(ref.issueNumber) || ref.issueNumber <= 0) return false;
  if (!ref.repoFullName) return true;
  return ref.repoFullName.toLowerCase() === wantedRepo(repositoryFullName);
}

function collectFromRegex(
  regex: RegExp,
  text: string,
  repositoryFullName: string,
): number[] {
  const numbers: number[] = [];
  if (!text) return numbers;
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const ref = parseIssueTarget(match.groups);
    if (ref && countsForRepo(ref, repositoryFullName)) {
      numbers.push(ref.issueNumber);
    }
  }
  return numbers;
}

/** Mask `Duplicate of #N` so a title hash scan does not treat it as a reference. */
export function stripDuplicateOf(text: string): string {
  if (!text) return text;
  return text.replace(DUPLICATE_OF, (span) => " ".repeat(span.length));
}

export function nonClosingIssueNumbersForRepo(
  texts: Array<string | undefined | null>,
  repositoryFullName: string,
): number[] {
  const numbers = new Set<number>();
  for (const text of texts) {
    if (!text) continue;
    for (const n of collectFromRegex(NON_CLOSING_REF, text, repositoryFullName)) {
      numbers.add(n);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

export function titleBareIssueNumbersForRepo(
  title: string | undefined | null,
  repositoryFullName: string,
): number[] {
  if (!title) return [];
  return collectFromRegex(BARE_TARGET, stripDuplicateOf(title), repositoryFullName);
}

/**
 * All issue numbers this PR references in the bounty repository.
 * Sidebar / GraphQL numbers are assumed same-repo (GitHub already scoped them).
 */
export function referencedIssueNumbersForRepo(
  pr: {
    title?: string | null;
    body?: string | null;
    commitMessages?: Array<string | null | undefined>;
    closingIssueNumbers?: number[];
  },
  repositoryFullName: string,
): number[] {
  const numbers = new Set<number>();
  const texts = [pr.title, pr.body, ...(pr.commitMessages ?? [])];
  for (const n of closingIssueNumbersForRepo(texts, repositoryFullName)) {
    numbers.add(n);
  }
  for (const n of nonClosingIssueNumbersForRepo(texts, repositoryFullName)) {
    numbers.add(n);
  }
  for (const n of titleBareIssueNumbersForRepo(pr.title, repositoryFullName)) {
    numbers.add(n);
  }
  for (const n of pr.closingIssueNumbers ?? []) {
    if (Number.isInteger(n) && n > 0) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b);
}

export function pullRequestReferencesIssue(
  pr: {
    title?: string | null;
    body?: string | null;
    commitMessages?: Array<string | null | undefined>;
    closingIssueNumbers?: number[];
  },
  issueNumber: number,
  repositoryFullName: string,
): boolean {
  return referencedIssueNumbersForRepo(pr, repositoryFullName).includes(issueNumber);
}
