/**
 * GitHub closing-keyword parser (promoted from V0-B).
 *
 * Keywords (same-repo `KEYWORD #N` or cross-repo `KEYWORD owner/repo#N`), from
 * https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
 *
 *   close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved
 *
 * Optional colon; case-insensitive. Also accepts issue URLs:
 * `Fixes https://github.com/owner/repo/issues/N`
 *
 * GitHub only honors these when the PR targets the **default branch**. That
 * gate lives in the eligibility engine, not here.
 *
 * Known GitHub false-positive we reproduce: a keyword still matches inside
 * quotes or negation (`must NOT close #N`).
 */

const KEYWORD = String.raw`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)`;

const CLOSING_REF = new RegExp(
  String.raw`(^|[^A-Za-z])(?:${KEYWORD})\s*:?\s+(?:https://github\.com/([^/\s]+/[^/\s]+)/(?:issues|pull)/(\d+)|([^/\s#]+/[^/\s#]+)#(\d+)|#(\d+))`,
  "gi",
);

export type ClosingRef = {
  issueNumber: number;
  /** Undefined means same-repository shorthand `#N`. */
  repoFullName?: string;
};

export function extractClosingRefs(text: string): ClosingRef[] {
  const refs: ClosingRef[] = [];
  if (!text) {
    return refs;
  }
  CLOSING_REF.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLOSING_REF.exec(text)) !== null) {
    const urlRepo = match[2];
    const urlNumber = match[3];
    const shorthandRepo = match[4];
    const shorthandNumber = match[5];
    const sameRepoNumber = match[6];
    if (urlRepo && urlNumber) {
      refs.push({
        issueNumber: Number(urlNumber),
        repoFullName: urlRepo,
      });
    } else if (shorthandRepo && shorthandNumber) {
      refs.push({
        issueNumber: Number(shorthandNumber),
        repoFullName: shorthandRepo,
      });
    } else if (sameRepoNumber) {
      refs.push({ issueNumber: Number(sameRepoNumber) });
    }
  }
  return refs;
}

export function closingIssueNumbersForRepo(
  texts: Array<string | undefined | null>,
  repositoryFullName: string,
): number[] {
  const wanted = repositoryFullName.toLowerCase();
  const numbers = new Set<number>();
  for (const text of texts) {
    if (!text) continue;
    for (const ref of extractClosingRefs(text)) {
      if (ref.repoFullName && ref.repoFullName.toLowerCase() !== wanted) {
        continue;
      }
      if (Number.isInteger(ref.issueNumber) && ref.issueNumber > 0) {
        numbers.add(ref.issueNumber);
      }
    }
  }
  return [...numbers].sort((a, b) => a - b);
}
