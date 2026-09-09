import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, claims, githubLinks, repos } from "../db/schema";
import type { ClaimWriteResult, EligibilityDecision, GitHubWebhookPayload } from "./types";

/** Bounty statuses that still have face value open for a merge winner. */
export const FUNDED_BOUNTY_STATUSES = ["funded", "claim_locked"] as const;

const TERMINAL_CLAIM_STATUSES = new Set(["paid", "disputed"]);

export type ClaimWriter = {
  markEligible(
    decision: EligibilityDecision,
    payload: GitHubWebhookPayload,
  ): Promise<ClaimWriteResult[]>;
};

export function postgresClaimWriter(db: Database): ClaimWriter {
  return {
    markEligible: (decision, payload) =>
      markEligibleClaims(decision, payload, db),
  };
}

export async function markEligibleClaims(
  decision: EligibilityDecision,
  payload: GitHubWebhookPayload,
  db: Database,
): Promise<ClaimWriteResult[]> {
  if (!decision.eligible || decision.closedIssueNumbers.length === 0) {
    return [];
  }

  const fullName = decision.repositoryFullName;
  if (!fullName) {
    return decision.closedIssueNumbers.map((issueNumber) => ({
      issueNumber,
      skip: "repo_unknown",
    }));
  }

  const [repo] = await db
    .select()
    .from(repos)
    .where(
      and(
        sql`lower(${repos.fullName}) = ${fullName.toLowerCase()}`,
        eq(repos.isActive, true),
      ),
    )
    .limit(1);

  if (!repo) {
    return decision.closedIssueNumbers.map((issueNumber) => ({
      issueNumber,
      skip: "repo_not_connected",
    }));
  }

  const hunter = await findHunter(db, decision);
  const prNumber = decision.pullRequestNumber;
  const prUrl =
    payload.pull_request?.html_url ??
    (prNumber != null ? `https://github.com/${fullName}/pull/${prNumber}` : null);
  const mergedAtRaw = payload.pull_request?.merged_at;
  const mergedAt = mergedAtRaw ? new Date(mergedAtRaw) : new Date();
  const mergeCommitSha = payload.pull_request?.merge_commit_sha ?? null;

  const results: ClaimWriteResult[] = [];
  for (const issueNumber of decision.closedIssueNumbers) {
    const [bounty] = await db
      .select()
      .from(bounties)
      .where(
        and(
          eq(bounties.repoId, repo.id),
          eq(bounties.githubIssueNumber, issueNumber),
          inArray(bounties.status, [...FUNDED_BOUNTY_STATUSES]),
        ),
      )
      .limit(1);

    if (!bounty) {
      results.push({ issueNumber, skip: "no_funded_bounty" });
      continue;
    }

    if (!hunter) {
      results.push({
        issueNumber,
        bountyId: bounty.id,
        skip: "hunter_not_linked",
      });
      continue;
    }

    if (prNumber == null) {
      results.push({ issueNumber, bountyId: bounty.id, skip: "pr_number_missing" });
      continue;
    }

    const [existing] = await db
      .select()
      .from(claims)
      .where(and(eq(claims.bountyId, bounty.id), eq(claims.prNumber, prNumber)))
      .limit(1);

    if (existing && TERMINAL_CLAIM_STATUSES.has(existing.status)) {
      results.push({
        issueNumber,
        bountyId: bounty.id,
        claimId: existing.id,
        status: existing.status,
        skip: "claim_terminal",
      });
      continue;
    }

    if (existing) {
      const [updated] = await db
        .update(claims)
        .set({
          status: "eligible",
          prUrl,
          prAuthorLogin: decision.winnerLogin ?? existing.prAuthorLogin,
          mergedAt,
          mergeCommitSha,
          closedIssueNumber: issueNumber,
          updatedAt: new Date(),
        })
        .where(eq(claims.id, existing.id))
        .returning({ id: claims.id, status: claims.status });
      results.push({
        issueNumber,
        bountyId: bounty.id,
        claimId: updated?.id ?? existing.id,
        status: updated?.status ?? "eligible",
      });
      continue;
    }

    const [inserted] = await db
      .insert(claims)
      .values({
        bountyId: bounty.id,
        hunterUserId: hunter.userId,
        status: "eligible",
        prNumber,
        prUrl,
        prAuthorLogin: decision.winnerLogin ?? null,
        mergedAt,
        mergeCommitSha,
        closedIssueNumber: issueNumber,
      })
      .returning({ id: claims.id, status: claims.status });

    results.push({
      issueNumber,
      bountyId: bounty.id,
      claimId: inserted?.id,
      status: inserted?.status ?? "eligible",
    });
  }

  return results;
}

async function findHunter(
  db: Database,
  decision: EligibilityDecision,
): Promise<{ userId: string } | null> {
  if (decision.winnerId != null) {
    const [byId] = await db
      .select({ userId: githubLinks.userId })
      .from(githubLinks)
      .where(eq(githubLinks.githubId, BigInt(decision.winnerId)))
      .limit(1);
    if (byId) return byId;
  }

  const login = decision.winnerLogin?.trim();
  if (!login) return null;
  const [byLogin] = await db
    .select({ userId: githubLinks.userId })
    .from(githubLinks)
    .where(sql`lower(${githubLinks.githubLogin}) = ${login.toLowerCase()}`)
    .limit(1);
  return byLogin ?? null;
}
