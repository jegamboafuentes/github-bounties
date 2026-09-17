/**
 * V2-2 pool freeze writer. On winning merge, snapshot GitHub and persist
 * `pool_participants`. Does **not** move USDC and does **not** acquire
 * exclusive claim-locks. Incremental `opened` / `synchronize` /
 * `ready_for_review` upsert unfrozen candidates for roster UX only.
 */

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { bounties, githubLinks, poolParticipants } from "../db/schema";
import {
  fetchPoolPullRequests,
  poolPullRequestFromWebhook,
} from "../github/pool-snapshot";
import {
  findActiveRepoByFullName,
  findGithubLinkByIdOrLogin,
  findGithubLinkByUserId,
} from "../github/persist";
import { referencedIssueNumbersForRepo } from "../lib/issue-refs";
import {
  evaluatePoolEligibility,
  isBotAccount,
  isPoolPayableBountyStatus,
  type PoolActor,
  type PoolEligibilityInput,
  type PoolPullRequest,
} from "../lib/pool-eligibility";
import { frozenParticipantsFromEligibility } from "../lib/pool-freeze-rows";
import { FUNDED_BOUNTY_STATUSES } from "./claims";
import { CLAIM_SKIP } from "./outcome";
import type {
  ClaimWriteResult,
  EligibilityDecision,
  GitHubWebhookPayload,
  PoolWriteResult,
} from "./types";

export const LIVE_ROSTER_ACTIONS = new Set([
  "opened",
  "synchronize",
  "ready_for_review",
]);

export function isLiveRosterAction(event: string, action?: string): boolean {
  return event === "pull_request" && Boolean(action && LIVE_ROSTER_ACTIONS.has(action));
}

export type PoolPullRequestFetcher = (args: {
  owner: string;
  repo: string;
  issueNumber: number;
  installationId?: number | null;
  includePullNumbers?: number[];
}) => Promise<PoolPullRequest[]>;

export type PoolWriter = {
  freezeAfterWinner(args: {
    decision: EligibilityDecision;
    payload: GitHubWebhookPayload;
    claimResults?: ClaimWriteResult[];
  }): Promise<PoolWriteResult[]>;
  ingestLiveRoster(args: {
    event: string;
    payload: GitHubWebhookPayload;
  }): Promise<PoolWriteResult[]>;
};

export function postgresPoolWriter(
  db: Database,
  opts: { fetchPullRequests?: PoolPullRequestFetcher } = {},
): PoolWriter {
  return {
    freezeAfterWinner: (args) => freezeAfterWinner(args, db, opts),
    ingestLiveRoster: (args) => ingestLiveRoster(args, db, opts),
  };
}

export async function freezeAfterWinner(
  args: {
    decision: EligibilityDecision;
    payload: GitHubWebhookPayload;
    claimResults?: ClaimWriteResult[];
  },
  db: Database,
  opts: { fetchPullRequests?: PoolPullRequestFetcher } = {},
): Promise<PoolWriteResult[]> {
  if (!args.decision.eligible || args.decision.closedIssueNumbers.length === 0) {
    return [];
  }

  const fullName = args.decision.repositoryFullName;
  if (!fullName || !fullName.includes("/")) {
    return args.decision.closedIssueNumbers.map((issueNumber) => ({
      issueNumber,
      skip: CLAIM_SKIP.repoUnknown,
    }));
  }

  const repo = await findActiveRepoByFullName(fullName, db);
  if (!repo) {
    return args.decision.closedIssueNumbers.map((issueNumber) => ({
      issueNumber,
      skip: CLAIM_SKIP.repoNotConnected,
    }));
  }

  const results: PoolWriteResult[] = [];
  for (const issueNumber of args.decision.closedIssueNumbers) {
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

    if (!bounty || !isPoolPayableBountyStatus(bounty.status)) {
      results.push({ issueNumber, skip: CLAIM_SKIP.noFundedBounty });
      continue;
    }

    const already = await bountyIsFrozen(db, bounty.id);
    if (already) {
      await attachLinkedUsers(db, bounty.id);
      const count = await countParticipants(db, bounty.id);
      results.push({
        issueNumber,
        bountyId: bounty.id,
        frozen: true,
        alreadyFrozen: true,
        participantCount: count,
      });
      continue;
    }

    const poster = await posterActor(db, bounty.posterUserId);
    const winner: PoolActor = {
      login: args.decision.winnerLogin ?? args.payload.pull_request?.user?.login ?? "",
      githubId:
        args.decision.winnerId ??
        (typeof args.payload.pull_request?.user?.id === "number"
          ? args.payload.pull_request.user.id
          : 0),
    };
    if (!winner.login || !winner.githubId) {
      results.push({
        issueNumber,
        bountyId: bounty.id,
        skip: "winner_identity_missing",
      });
      continue;
    }

    const webhookPr = poolPullRequestFromWebhook(args.payload);
    const installationId = args.payload.installation?.id ?? repo.installationId;
    if (installationId == null && !opts.fetchPullRequests) {
      results.push({
        issueNumber,
        bountyId: bounty.id,
        skip: "github_snapshot_unavailable",
        frozen: false,
      });
      continue;
    }

    let snapshot: PoolPullRequest[] = [];
    try {
      snapshot = await loadSnapshot({
        fullName,
        issueNumber,
        installationId,
        includePullNumbers: [
          args.decision.pullRequestNumber,
          webhookPr?.number,
        ].filter((n): n is number => n != null),
        fetchPullRequests: opts.fetchPullRequests,
      });
    } catch {
      results.push({
        issueNumber,
        bountyId: bounty.id,
        skip: "github_snapshot_unavailable",
        frozen: false,
      });
      continue;
    }

    if (webhookPr && !snapshot.some((pr) => pr.number === webhookPr.number)) {
      snapshot = [webhookPr, ...snapshot];
    }

    const input: PoolEligibilityInput = {
      bounty: {
        issueNumber,
        repositoryFullName: fullName,
        status: bounty.status,
        poster,
      },
      winner,
      winningMerge: {
        prNumber: args.decision.pullRequestNumber ?? webhookPr?.number ?? 0,
        mergedAt:
          args.payload.pull_request?.merged_at ??
          webhookPr?.createdAt ??
          new Date().toISOString(),
      },
      pullRequests: snapshot,
    };

    const eligibility = evaluatePoolEligibility(input);
    const linkedIds = await linkedGithubIdSet(db, [
      winner.githubId,
      poster.githubId,
      ...eligibility.paid.map((m) => m.githubId),
      ...eligibility.overflow.map((m) => m.githubId),
      ...eligibility.skipped.map((s) => s.githubId),
    ]);
    const frozen = frozenParticipantsFromEligibility(
      input,
      bounty.amountUsdc,
      eligibility,
      linkedIds,
    );
    const frozenAt = new Date(
      args.payload.pull_request?.merged_at ?? Date.now(),
    );

    for (const row of frozen.rows) {
      await upsertFrozenParticipant(db, bounty.id, row, frozenAt);
    }

    results.push({
      issueNumber,
      bountyId: bounty.id,
      frozen: true,
      alreadyFrozen: false,
      paidCount: frozen.paidCount,
      overflowCount: frozen.rows.filter((r) => r.role === "overflow").length,
      participantCount: frozen.rows.length,
      skipped: frozen.skipped.map((s) => ({
        login: s.login,
        reason: s.reason,
        prNumber: s.prNumber,
      })),
    });
  }

  return results;
}

export async function ingestLiveRoster(
  args: { event: string; payload: GitHubWebhookPayload },
  db: Database,
  opts: { fetchPullRequests?: PoolPullRequestFetcher } = {},
): Promise<PoolWriteResult[]> {
  if (!isLiveRosterAction(args.event, args.payload.action)) return [];
  if (args.payload.pull_request?.merged) return [];

  const pr = poolPullRequestFromWebhook(args.payload);
  if (!pr || !pr.authorLogin || !pr.authorId) return [];
  if (isBotAccount(pr)) return [];

  const fullName =
    args.payload.repository?.full_name ?? pr.baseRepositoryFullName;
  if (!fullName) return [];

  const repo = await findActiveRepoByFullName(fullName, db);
  if (!repo) return [];

  let withCommits = pr;
  const [owner, name] = fullName.split("/");
  if (owner && name && opts.fetchPullRequests) {
    try {
      const fetched = await opts.fetchPullRequests({
        owner,
        repo: name,
        issueNumber: 0,
        installationId: args.payload.installation?.id ?? Number(repo.installationId),
        includePullNumbers: [pr.number],
      });
      const match = fetched.find((row) => row.number === pr.number);
      if (match) withCommits = match;
    } catch {
      // Incremental ingest is UX; freeze backfill is truth.
    }
  }

  const issueNumbers = referencedIssueNumbersForRepo(withCommits, fullName);
  if (issueNumbers.length === 0) return [];

  const results: PoolWriteResult[] = [];
  for (const issueNumber of issueNumbers) {
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
    if (!bounty) continue;

    if (await bountyIsFrozen(db, bounty.id)) {
      results.push({
        issueNumber,
        bountyId: bounty.id,
        frozen: true,
        alreadyFrozen: true,
        ingested: false,
        skip: "late_pr",
      });
      continue;
    }

    const link = await findGithubLinkByIdOrLogin(db, {
      githubId: withCommits.authorId,
      githubLogin: withCommits.authorLogin,
    });
    await upsertCandidate(db, {
      bountyId: bounty.id,
      githubId: withCommits.authorId,
      githubLogin: withCommits.authorLogin,
      userId: link?.userId ?? null,
      pr: withCommits,
      fullName,
    });
    results.push({
      issueNumber,
      bountyId: bounty.id,
      frozen: false,
      ingested: true,
      participantCount: 1,
    });
  }
  return results;
}

/**
 * After Connect GitHub, attach `user_id` on frozen (or candidate) rows whose
 * github_id / login now match. Does not change `frozen_at` or shares.
 */
export async function backfillUnlinkedPoolParticipants(
  hunter: { userId: string; githubLogin: string; githubId?: bigint },
  db: Database,
): Promise<number> {
  const login = hunter.githubLogin.trim().toLowerCase();
  if (!login && hunter.githubId == null) return 0;

  const rows = await db.select().from(poolParticipants).where(isNull(poolParticipants.userId));
  let updated = 0;
  for (const row of rows) {
    const idMatch =
      hunter.githubId != null && row.githubId === hunter.githubId;
    const loginMatch = row.githubLogin.trim().toLowerCase() === login;
    if (!idMatch && !loginMatch) continue;
    const nextSkip =
      row.skipReason === CLAIM_SKIP.hunterNotLinked ? null : row.skipReason;
    await db
      .update(poolParticipants)
      .set({
        userId: hunter.userId,
        skipReason: nextSkip,
        updatedAt: new Date(),
      })
      .where(eq(poolParticipants.id, row.id));
    updated += 1;
  }
  return updated;
}

async function loadSnapshot(args: {
  fullName: string;
  issueNumber: number;
  installationId?: number | bigint | null;
  includePullNumbers: number[];
  fetchPullRequests?: PoolPullRequestFetcher;
}): Promise<PoolPullRequest[]> {
  const [owner, repo] = args.fullName.split("/");
  if (!owner || !repo) return [];
  const installationId =
    args.installationId == null ? null : Number(args.installationId);
  if (args.fetchPullRequests) {
    return args.fetchPullRequests({
      owner,
      repo,
      issueNumber: args.issueNumber,
      installationId,
      includePullNumbers: args.includePullNumbers,
    });
  }
  return fetchPoolPullRequests({
    owner,
    repo,
    issueNumber: args.issueNumber,
    installationId,
    includePullNumbers: args.includePullNumbers,
  });
}

async function bountyIsFrozen(db: Database, bountyId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: poolParticipants.id })
    .from(poolParticipants)
    .where(
      and(eq(poolParticipants.bountyId, bountyId), isNotNull(poolParticipants.frozenAt)),
    )
    .limit(1);
  return Boolean(row);
}

async function countParticipants(db: Database, bountyId: string): Promise<number> {
  const rows = await db
    .select({ id: poolParticipants.id })
    .from(poolParticipants)
    .where(eq(poolParticipants.bountyId, bountyId));
  return rows.length;
}

async function posterActor(db: Database, posterUserId: string): Promise<PoolActor> {
  const link = await findGithubLinkByUserId(posterUserId, db);
  if (!link) return { login: "", githubId: 0 };
  return {
    login: link.githubLogin,
    githubId: Number(link.githubId),
  };
}

async function linkedGithubIdSet(
  db: Database,
  githubIds: number[],
): Promise<Set<number>> {
  const unique = [...new Set(githubIds.filter((id) => id > 0))];
  if (unique.length === 0) return new Set();
  const rows = await db
    .select({ githubId: githubLinks.githubId })
    .from(githubLinks)
    .where(
      inArray(
        githubLinks.githubId,
        unique.map((id) => BigInt(id)),
      ),
    );
  return new Set(rows.map((row) => Number(row.githubId)));
}

async function upsertFrozenParticipant(
  db: Database,
  bountyId: string,
  row: ReturnType<typeof frozenParticipantsFromEligibility>["rows"][number],
  frozenAt: Date,
): Promise<void> {
  const link = await findGithubLinkByIdOrLogin(db, {
    githubId: row.githubId,
    githubLogin: row.githubLogin,
  });
  const values = {
    bountyId,
    githubId: BigInt(row.githubId),
    githubLogin: row.githubLogin,
    userId: link?.userId ?? null,
    role: row.role,
    qualifyingPrNumber: row.qualifyingPrNumber,
    qualifyingPrCreatedAt: row.qualifyingPrCreatedAt
      ? new Date(row.qualifyingPrCreatedAt)
      : null,
    qualifyingPrUrl: row.qualifyingPrUrl,
    commitSha: row.commitSha,
    frozenAt,
    shareUsdc: row.shareUsdc,
    skipReason: row.skipReason,
    updatedAt: new Date(),
  };

  const [existing] = await db
    .select()
    .from(poolParticipants)
    .where(
      and(
        eq(poolParticipants.bountyId, bountyId),
        eq(poolParticipants.githubId, BigInt(row.githubId)),
      ),
    )
    .limit(1);

  if (existing?.frozenAt) return;

  if (existing) {
    await db
      .update(poolParticipants)
      .set(values)
      .where(eq(poolParticipants.id, existing.id));
    return;
  }

  try {
    await db.insert(poolParticipants).values(values);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
}

async function upsertCandidate(
  db: Database,
  args: {
    bountyId: string;
    githubId: number;
    githubLogin: string;
    userId: string | null;
    pr: PoolPullRequest;
    fullName: string;
  },
): Promise<void> {
  const [existing] = await db
    .select()
    .from(poolParticipants)
    .where(
      and(
        eq(poolParticipants.bountyId, args.bountyId),
        eq(poolParticipants.githubId, BigInt(args.githubId)),
      ),
    )
    .limit(1);
  if (existing?.frozenAt) return;

  const values = {
    bountyId: args.bountyId,
    githubId: BigInt(args.githubId),
    githubLogin: args.githubLogin,
    userId: args.userId ?? existing?.userId ?? null,
    role: "pool" as const,
    qualifyingPrNumber: args.pr.number,
    qualifyingPrCreatedAt: new Date(args.pr.createdAt),
    qualifyingPrUrl:
      args.pr.htmlUrl ?? `https://github.com/${args.fullName}/pull/${args.pr.number}`,
    commitSha: args.pr.commitsAtFreeze?.[0]?.sha ?? existing?.commitSha ?? null,
    frozenAt: null,
    shareUsdc: "0",
    skipReason: (args.userId ?? existing?.userId)
      ? null
      : CLAIM_SKIP.hunterNotLinked,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(poolParticipants)
      .set(values)
      .where(eq(poolParticipants.id, existing.id));
    return;
  }
  try {
    await db.insert(poolParticipants).values(values);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
}

async function attachLinkedUsers(db: Database, bountyId: string): Promise<void> {
  const rows = await db
    .select()
    .from(poolParticipants)
    .where(and(eq(poolParticipants.bountyId, bountyId), isNull(poolParticipants.userId)));
  for (const row of rows) {
    const link = await findGithubLinkByIdOrLogin(db, {
      githubId: row.githubId,
      githubLogin: row.githubLogin,
    });
    if (!link) continue;
    const nextSkip =
      row.skipReason === CLAIM_SKIP.hunterNotLinked ? null : row.skipReason;
    await db
      .update(poolParticipants)
      .set({
        userId: link.userId,
        skipReason: nextSkip,
        updatedAt: new Date(),
      })
      .where(eq(poolParticipants.id, row.id));
  }
}
