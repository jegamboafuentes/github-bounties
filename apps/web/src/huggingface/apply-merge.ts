import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import {
  bountyContributions,
  bountySubmissions,
  bounties,
  claims,
  hfLinks,
  repos,
  webhookDeliveries,
  type HfRepoType,
  type WebhookClaimResult,
} from "../db/schema";
import { notifyPullRequestWon, type DomainEmailDeps } from "../email/events";
import type { GitHubHttp } from "../github/api";
import {
  fetchHuggingFaceDiscussion,
  hfBountiesEnabled,
  huggingFaceDiscussionUrl,
  isHuggingFaceReadError,
} from "../providers/huggingface";
import { FUNDED_BOUNTY_STATUSES } from "../webhooks/claims";
import {
  getDelivery,
  recordDeliveryIfNew,
  updateDeliveryOutcome,
} from "../webhooks/delivery-store";
import { CLAIM_SKIP, shouldRetryClaimWrites } from "../webhooks/outcome";
import type { EligibilityDecision } from "../webhooks/types";
import {
  fetchHuggingFaceDefaultBranch,
  fetchHuggingFaceOrgMembers,
  liveHuggingFaceHttp,
  orgMemberLogin,
} from "./hub";
import {
  evaluateHuggingFaceMerge,
  HF_MERGE_SKIP,
  preliminaryMergeSkip,
  type HfIdentity,
  type HfMergeDecision,
} from "./merge-rules";

const TERMINAL_CLAIM_STATUSES = new Set(["paid", "rejected"]);

export type HfMergeTarget = {
  repoType: HfRepoType;
  owner: string;
  repo: string;
  prNumber: number;
};

export type ApplyHfMergeInput = {
  deliveryId: string;
  event: string;
  action?: string;
  target: HfMergeTarget;
  /** Poller replays a not-merged read. Webhook replays only while no claim row exists. */
  refresh?: boolean;
};

export type ApplyHfMergeResult = {
  httpStatus: number;
  body: Record<string, unknown>;
  eligible: boolean;
  claimsWritten: number;
  duplicate: boolean;
};

export function hfPollDeliveryId(repoType: HfRepoType, fullName: string, prNumber: number): string {
  return `hf-poll:${repoType}:${fullName.toLowerCase()}#${prNumber}`;
}

export function hfRepoTypeFromAction(action: string | null | undefined): HfRepoType | null {
  const suffix = action?.split(":").pop()?.toLowerCase();
  if (suffix === "model" || suffix === "dataset" || suffix === "space") return suffix;
  return null;
}

type SubmissionTarget = {
  submissionId: string;
  prUrl: string;
  bountyId: string;
  githubIssueNumber: number;
  bountyCreatedAt: Date;
  posterUserId: string;
  repoFullName: string;
  repoOwner: string;
};

function decisionOf(input: {
  eligible: boolean;
  winnerLogin: string | null;
  prNumber: number;
  fullName: string;
}): EligibilityDecision {
  return {
    eligible: input.eligible,
    reason: input.eligible ? "hf_merged" : "hf_not_eligible",
    winnerLogin: input.winnerLogin ?? undefined,
    closedIssueNumbers: [],
    pullRequestNumber: input.prNumber,
    repositoryFullName: input.fullName,
  };
}

function parseTime(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function loadTargets(
  db: Database,
  target: HfMergeTarget,
): Promise<SubmissionTarget[]> {
  const fullName = `${target.owner}/${target.repo}`;
  const rows = await db
    .select({
      submissionId: bountySubmissions.id,
      prUrl: bountySubmissions.prUrl,
      bountyId: bounties.id,
      githubIssueNumber: bounties.githubIssueNumber,
      bountyCreatedAt: bounties.createdAt,
      posterUserId: bounties.posterUserId,
      repoFullName: repos.fullName,
    })
    .from(bountySubmissions)
    .innerJoin(bounties, eq(bounties.id, bountySubmissions.bountyId))
    .innerJoin(repos, eq(repos.id, bounties.repoId))
    .where(
      and(
        eq(bountySubmissions.status, "submitted"),
        eq(bountySubmissions.prNumber, target.prNumber),
        eq(bounties.provider, "huggingface"),
        inArray(bounties.status, [...FUNDED_BOUNTY_STATUSES]),
        isNull(bounties.deletedAt),
        eq(repos.provider, "huggingface"),
        eq(repos.hfRepoType, target.repoType),
        sql`lower(${repos.fullName}) = ${fullName.toLowerCase()}`,
      ),
    );
  return rows.map((row) => ({
    ...row,
    repoOwner: row.repoFullName.split("/")[0] ?? target.owner,
  }));
}

async function blockedIdentities(db: Database, targets: SubmissionTarget[]): Promise<Map<string, HfIdentity[]>> {
  const out = new Map<string, HfIdentity[]>();
  if (targets.length === 0) return out;
  const bountyIds = targets.map((row) => row.bountyId);
  const funders = await db
    .select({
      bountyId: bountyContributions.bountyId,
      funderUserId: bountyContributions.funderUserId,
    })
    .from(bountyContributions)
    .where(inArray(bountyContributions.bountyId, bountyIds));
  const usersByBounty = new Map<string, Set<string>>();
  for (const target of targets) {
    usersByBounty.set(target.bountyId, new Set([target.posterUserId]));
  }
  for (const funder of funders) {
    const set = usersByBounty.get(funder.bountyId) ?? new Set<string>();
    set.add(funder.funderUserId);
    usersByBounty.set(funder.bountyId, set);
  }
  const userIds = [...new Set([...usersByBounty.values()].flatMap((set) => [...set]))];
  if (userIds.length === 0) return out;
  const links = await db
    .select({ userId: hfLinks.userId, hfUsername: hfLinks.hfUsername, hfSub: hfLinks.hfSub })
    .from(hfLinks)
    .where(inArray(hfLinks.userId, userIds));
  const byUser = new Map(links.map((link) => [link.userId, link]));
  for (const [bountyId, ids] of usersByBounty) {
    const identities: HfIdentity[] = [];
    for (const userId of ids) {
      const link = byUser.get(userId);
      if (!link) continue;
      identities.push({ login: link.hfUsername, id: link.hfSub });
    }
    out.set(bountyId, identities);
  }
  return out;
}

async function findHunter(
  db: Database,
  author: HfIdentity,
): Promise<{ userId: string } | null> {
  const login = author.login?.trim().toLowerCase() ?? "";
  const id = author.id?.trim() ?? "";
  if (!login && !id) return null;
  const rows = await db
    .select({ userId: hfLinks.userId, hfUsername: hfLinks.hfUsername, hfSub: hfLinks.hfSub })
    .from(hfLinks)
    .where(
      or(
        login ? sql`lower(${hfLinks.hfUsername}) = ${login}` : sql`false`,
        id ? eq(hfLinks.hfSub, id) : sql`false`,
      ),
    );
  const byId = id ? rows.find((row) => row.hfSub === id) : undefined;
  return byId ?? rows[0] ?? null;
}

async function writeClaim(
  db: Database,
  input: {
    bountyId: string;
    hunterUserId: string;
    status: "eligible" | "disputed";
    rejectionReason: string | null;
    prNumber: number;
    prUrl: string;
    author: HfIdentity;
    merger: HfIdentity | null;
    mergeCommitId: string | null;
    mergedAt: Date | null;
    issueNumber: number;
  },
  email?: DomainEmailDeps,
): Promise<{ claimId: string; status: string; wrote: boolean }> {
  const values = {
    status: input.status,
    hunterUserId: input.hunterUserId,
    prUrl: input.prUrl,
    prAuthorLogin: input.author.login,
    prAuthorProviderId: input.author.id,
    mergedByLogin: input.merger?.login ?? null,
    mergedByProviderId: input.merger?.id ?? null,
    mergedAt: input.mergedAt,
    mergeCommitSha: input.mergeCommitId,
    closedIssueNumber: input.issueNumber,
    rejectionReason: input.rejectionReason,
    updatedAt: new Date(),
  };
  const [existing] = await db
    .select()
    .from(claims)
    .where(and(eq(claims.bountyId, input.bountyId), eq(claims.prNumber, input.prNumber)))
    .limit(1);
  if (existing && (TERMINAL_CLAIM_STATUSES.has(existing.status) || existing.status === "paid")) {
    return { claimId: existing.id, status: existing.status, wrote: false };
  }
  if (existing?.status === "disputed" && existing.rejectionReason !== HF_MERGE_SKIP.mergerReviewRequired) {
    return { claimId: existing.id, status: existing.status, wrote: false };
  }
  if (existing?.status === "eligible" && input.status !== "eligible") {
    return { claimId: existing.id, status: existing.status, wrote: false };
  }
  if (existing) {
    const [updated] = await db
      .update(claims)
      .set(values)
      .where(eq(claims.id, existing.id))
      .returning({ id: claims.id, status: claims.status });
    const claimId = updated?.id ?? existing.id;
    const status = updated?.status ?? input.status;
    const wrote = existing.status !== status;
    if (wrote && status === "eligible") await notifyPullRequestWon(db, claimId, email);
    return { claimId, status, wrote };
  }
  try {
    const [inserted] = await db
      .insert(claims)
      .values({
        bountyId: input.bountyId,
        prNumber: input.prNumber,
        ...values,
      })
      .returning({ id: claims.id, status: claims.status });
    if (!inserted) throw new Error("insert huggingface claim returned no row");
    if (inserted.status === "eligible") await notifyPullRequestWon(db, inserted.id, email);
    return { claimId: inserted.id, status: inserted.status, wrote: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [race] = await db
      .select({ id: claims.id, status: claims.status })
      .from(claims)
      .where(and(eq(claims.bountyId, input.bountyId), eq(claims.prNumber, input.prNumber)))
      .limit(1);
    if (!race) throw err;
    return { claimId: race.id, status: race.status, wrote: false };
  }
}

/**
 * Re-read the Hub discussion and write at most one winner claim per submitted
 * pull request. Flag off: no Hub call and no claim. Hub 429, timeout, and 5xx
 * throw so the webhook can answer 503 without recording the delivery.
 */
export async function applyHuggingFaceMerge(
  db: Database,
  input: ApplyHfMergeInput,
  opts: { http?: GitHubHttp; env?: NodeJS.ProcessEnv; email?: DomainEmailDeps } = {},
): Promise<ApplyHfMergeResult> {
  const env = opts.env ?? process.env;
  if (!hfBountiesEnabled(env)) {
    return {
      httpStatus: 200,
      eligible: false,
      claimsWritten: 0,
      duplicate: false,
      body: { ok: true, skipped: "hf_disabled" },
    };
  }

  const existing = await getDelivery(input.deliveryId, db);
  if (existing && !input.refresh && !shouldRetryClaimWrites(existing)) {
    return {
      httpStatus: 200,
      eligible: existing.eligible === true,
      claimsWritten: 0,
      duplicate: true,
      body: { ok: true, duplicate: true, eligible: existing.eligible === true },
    };
  }

  const http = opts.http ?? liveHuggingFaceHttp;
  const fullName = `${input.target.owner}/${input.target.repo}`;
  let discussion;
  try {
    discussion = await fetchHuggingFaceDiscussion(
      {
        provider: "huggingface",
        owner: input.target.owner,
        repo: input.target.repo,
        fullName,
        issueNumber: input.target.prNumber,
        url: huggingFaceDiscussionUrl(input.target.repoType, fullName, input.target.prNumber),
        hfRepoType: input.target.repoType,
      },
      { http, env },
    );
  } catch (err) {
    if (isHuggingFaceReadError(err) && err.code === "hf_discussion_not_found") {
      return finish(db, input, existing != null, {
        eligible: false,
        winnerLogin: null,
        fullName,
        results: [
          {
            issueNumber: input.target.prNumber,
            skip: HF_MERGE_SKIP.discussionNotFound,
            prNumber: input.target.prNumber,
            winnerLogin: null,
          },
        ],
        claimsWritten: 0,
      });
    }
    throw err;
  }

  const targets = await loadTargets(db, input.target);
  const author = { login: discussion.authorLogin, id: discussion.authorId };
  const early = preliminaryMergeSkip(discussion);
  if (early || targets.length === 0) {
    const skip = targets.length === 0 ? HF_MERGE_SKIP.noSubmission : early!;
    const results: WebhookClaimResult[] =
      targets.length === 0
        ? [
            {
              issueNumber: input.target.prNumber,
              skip,
              prNumber: input.target.prNumber,
              winnerLogin: author.login,
            },
          ]
        : targets.map((target) => ({
            issueNumber: target.githubIssueNumber,
            bountyId: target.bountyId,
            skip,
            prNumber: input.target.prNumber,
            winnerLogin: author.login,
          }));
    return finish(db, input, existing != null, {
      eligible: false,
      winnerLogin: author.login,
      fullName: discussion.fullName,
      results,
      claimsWritten: 0,
    });
  }

  const [defaultBranch, members] = await Promise.all([
    fetchHuggingFaceDefaultBranch(
      { type: input.target.repoType, owner: input.target.owner, repo: input.target.repo },
      { http, env },
    ),
    fetchHuggingFaceOrgMembers(input.target.owner, { http, env }),
  ]);
  const blocked = await blockedIdentities(db, targets);
  const createdAt = parseTime(discussion.createdAt);
  const results: WebhookClaimResult[] = [];
  let claimsWritten = 0;
  let eligible = false;
  const hunter = await findHunter(db, author);

  for (const target of targets) {
    const decision: HfMergeDecision = evaluateHuggingFaceMerge({
      isPullRequest: discussion.isPullRequest,
      status: discussion.status,
      mergeCommitId: discussion.mergeCommitId,
      baseRef: discussion.baseRef,
      defaultBranch,
      createdAt,
      bountyCreatedAt: target.bountyCreatedAt,
      author,
      authorIsOrgMember: discussion.authorIsOrgMember,
      orgMember: orgMemberLogin(members, author.login),
      merger: discussion.merger,
      repoOwner: target.repoOwner,
      blocked: blocked.get(target.bountyId) ?? [],
    });
    const meta = {
      issueNumber: target.githubIssueNumber,
      bountyId: target.bountyId,
      prNumber: input.target.prNumber,
      winnerLogin: author.login,
    };
    if (decision.kind === "deny") {
      results.push({ ...meta, skip: decision.skip });
      continue;
    }
    if (!hunter) {
      eligible = true;
      results.push({ ...meta, skip: CLAIM_SKIP.hunterNotLinked });
      continue;
    }
    const review = decision.kind === "review";
    const written = await writeClaim(
      db,
      {
        bountyId: target.bountyId,
        hunterUserId: hunter.userId,
        status: review ? "disputed" : "eligible",
        rejectionReason: review ? HF_MERGE_SKIP.mergerReviewRequired : null,
        prNumber: input.target.prNumber,
        prUrl: target.prUrl,
        author,
        merger: discussion.merger,
        mergeCommitId: discussion.mergeCommitId,
        mergedAt: parseTime(discussion.mergedAt) ?? createdAt,
        issueNumber: target.githubIssueNumber,
      },
      opts.email,
    );
    if (written.wrote) claimsWritten += 1;
    if (!review && written.status === "eligible") eligible = true;
    results.push({
      ...meta,
      claimId: written.claimId,
      status: written.status,
      skip: written.wrote ? undefined : CLAIM_SKIP.claimTerminal,
    });
  }

  return finish(db, input, existing != null, {
    eligible,
    winnerLogin: author.login,
    fullName: discussion.fullName,
    results,
    claimsWritten,
  });
}

async function finish(
  db: Database,
  input: ApplyHfMergeInput,
  existed: boolean,
  outcome: {
    eligible: boolean;
    winnerLogin: string | null;
    fullName: string;
    results: WebhookClaimResult[];
    claimsWritten: number;
  },
): Promise<ApplyHfMergeResult> {
  const entry = {
    deliveryId: input.deliveryId,
    event: input.event,
    action: input.action,
    provider: "huggingface" as const,
    decision: decisionOf({
      eligible: outcome.eligible,
      winnerLogin: outcome.winnerLogin,
      prNumber: input.target.prNumber,
      fullName: outcome.fullName,
    }),
    claims: outcome.results,
  };
  if (existed) await updateDeliveryOutcome(entry, db);
  else {
    const inserted = await recordDeliveryIfNew(entry, db);
    if (!inserted) await updateDeliveryOutcome(entry, db);
  }
  const duplicate = existed && outcome.claimsWritten === 0 && !outcome.eligible;
  return {
    httpStatus: 200,
    eligible: outcome.eligible,
    claimsWritten: outcome.claimsWritten,
    duplicate,
    body: {
      ok: true,
      duplicate,
      eligible: outcome.eligible,
      claims: outcome.results,
    },
  };
}

export async function backfillHuggingFaceClaimsForHunter(
  hunter: { userId: string; hfUsername: string; hfSub: string },
  db: Database,
  opts: { http?: GitHubHttp; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  const env = opts.env ?? process.env;
  if (!hfBountiesEnabled(env)) return;
  const login = hunter.hfUsername.trim().toLowerCase();
  const deliveries = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.provider, "huggingface"));
  for (const delivery of deliveries) {
    if (!shouldRetryClaimWrites(delivery)) continue;
    const winner = delivery.winnerLogin?.trim().toLowerCase() ?? "";
    if (!winner || (winner !== login && winner !== hunter.hfSub)) continue;
    const repoType = hfRepoTypeFromAction(delivery.action);
    const fullName = delivery.repositoryFullName ?? "";
    const [owner, repo, extra] = fullName.split("/");
    if (!repoType || !owner || !repo || extra || delivery.pullRequestNumber == null) continue;
    await applyHuggingFaceMerge(
      db,
      {
        deliveryId: delivery.deliveryId,
        event: delivery.event,
        action: delivery.action ?? undefined,
        refresh: true,
        target: { repoType, owner, repo, prNumber: delivery.pullRequestNumber },
      },
      { http: opts.http, env },
    );
  }
}
