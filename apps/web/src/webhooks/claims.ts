import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, claims, githubLinks, repos, webhookDeliveries } from "../db/schema";
import { CLAIM_SKIP } from "./outcome";
import type { ClaimWriteResult, EligibilityDecision, GitHubWebhookPayload } from "./types";

/** Bounty statuses that still have face value open for a merge winner. */
export const FUNDED_BOUNTY_STATUSES = ["funded", "claim_locked"] as const;

export { CLAIM_SKIP };

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

function resultMeta(
  decision: EligibilityDecision,
): Pick<ClaimWriteResult, "prNumber" | "winnerLogin"> {
  return {
    prNumber: decision.pullRequestNumber ?? null,
    winnerLogin: decision.winnerLogin ?? null,
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

  const meta = resultMeta(decision);
  const fullName = decision.repositoryFullName;
  if (!fullName) {
    return decision.closedIssueNumbers.map((issueNumber) => ({
      issueNumber,
      skip: CLAIM_SKIP.repoUnknown,
      ...meta,
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
      skip: CLAIM_SKIP.repoNotConnected,
      ...meta,
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
      results.push({ issueNumber, skip: CLAIM_SKIP.noFundedBounty, ...meta });
      continue;
    }

    if (!hunter) {
      results.push({
        issueNumber,
        bountyId: bounty.id,
        skip: CLAIM_SKIP.hunterNotLinked,
        ...meta,
      });
      continue;
    }

    if (prNumber == null) {
      results.push({
        issueNumber,
        bountyId: bounty.id,
        skip: CLAIM_SKIP.prNumberMissing,
        ...meta,
      });
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
        skip: CLAIM_SKIP.claimTerminal,
        ...meta,
      });
      continue;
    }

    if (existing) {
      const [updated] = await db
        .update(claims)
        .set({
          status: "eligible",
          hunterUserId: hunter.userId,
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
        ...meta,
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
      ...meta,
    });
  }

  return results;
}

/**
 * After Connect GitHub, attach any `hunter_not_linked` outcomes whose
 * winner login/id now matches this user. Safe if none are pending.
 */
export async function backfillUnlinkedClaimsForHunter(
  hunter: { userId: string; githubLogin: string; githubId?: bigint },
  db: Database,
): Promise<ClaimWriteResult[]> {
  const login = hunter.githubLogin.trim().toLowerCase();
  if (!login) return [];

  const deliveries = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.eligible, true));

  const written: ClaimWriteResult[] = [];
  for (const delivery of deliveries) {
    const rows = delivery.claimResults ?? [];
    const pending = rows.filter((row) => row.skip === CLAIM_SKIP.hunterNotLinked);
    if (pending.length === 0) continue;

    const winner = (delivery.winnerLogin ?? pending[0]?.winnerLogin ?? "").trim().toLowerCase();
    if (!winner || winner !== login) continue;

    if (!delivery.repositoryFullName) continue;

    const decision: EligibilityDecision = {
      eligible: true,
      reason: "github-link backfill",
      closedIssueNumbers: pending.map((row) => row.issueNumber),
      winnerLogin: hunter.githubLogin,
      winnerId:
        hunter.githubId != null && hunter.githubId <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(hunter.githubId)
          : undefined,
      pullRequestNumber: delivery.pullRequestNumber ?? pending[0]?.prNumber ?? undefined,
      repositoryFullName: delivery.repositoryFullName,
    };

    const payload: GitHubWebhookPayload = {
      pull_request: {
        number: decision.pullRequestNumber,
        html_url: decision.pullRequestNumber
          ? `https://github.com/${delivery.repositoryFullName}/pull/${decision.pullRequestNumber}`
          : null,
        user: { login: hunter.githubLogin },
      },
    };

    const next = await markEligibleClaims(decision, payload, db);
    written.push(...next);

    const byIssue = new Map(next.map((row) => [row.issueNumber, row]));
    const merged = rows.map((row) => byIssue.get(row.issueNumber) ?? row);
    await db
      .update(webhookDeliveries)
      .set({ claimResults: merged })
      .where(eq(webhookDeliveries.deliveryId, delivery.deliveryId));
  }

  return written;
}

/** Winner = merged PR author. Never the claim-lock holder. */
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
