import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { isUniqueViolation, uniqueViolationConstraint } from "../db/errors";
import { bounties, bountySubmissions, claims, hfLinks, repos } from "../db/schema";
import type { GitHubHttp } from "../github/api";
import {
  fetchHuggingFaceDiscussion,
  hfBountiesEnabled,
  huggingFaceDiscussionUrl,
  isHuggingFaceReadError,
} from "../providers/huggingface";
import { getProvider } from "../providers/registry";
import { ProviderNotSupportedError } from "../providers/types";
import { bountyErrorForHuggingFace } from "./hf-create";
import { BountyError } from "./errors";

const PAID_BOUNTY_STATUSES = new Set(["settling", "settled", "settled_partial"]);

export type SubmissionView = {
  id: string;
  bountyId: string;
  userId: string;
  provider: "huggingface";
  prUrl: string;
  prNum: number;
  hfAuthor: string;
  status: "submitted";
  createdAt: string;
};

export type SubmissionCall = {
  db: Database;
  env?: NodeJS.ProcessEnv;
  http?: GitHubHttp;
};

type BountyRow = {
  id: string;
  provider: string;
  status: string;
  deletedAt: Date | null;
  repoFullName: string;
  hfRepoType: "model" | "dataset" | "space" | null;
};

function namesMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = left?.trim().toLowerCase() ?? "";
  const b = right?.trim().toLowerCase() ?? "";
  return a.length > 0 && a === b;
}

function reposMatch(
  left: { type: string; fullName: string },
  right: { type: string | null; fullName: string },
): boolean {
  if (right.type && left.type !== right.type) return false;
  return left.fullName.trim().toLowerCase() === right.fullName.trim().toLowerCase();
}

/** Withdraw stays open until a payout has started or a claim is paid. */
export function submissionWithdrawOpen(status: string): boolean {
  return !PAID_BOUNTY_STATUSES.has(status);
}

function toView(row: {
  id: string;
  bountyId: string;
  userId: string;
  prUrl: string;
  prNumber: number;
  hfAuthor: string | null;
  status: string;
  createdAt: Date;
}): SubmissionView {
  return {
    id: row.id,
    bountyId: row.bountyId,
    userId: row.userId,
    provider: "huggingface",
    prUrl: row.prUrl,
    prNum: row.prNumber,
    hfAuthor: row.hfAuthor ?? "",
    status: "submitted",
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadBounty(db: Database, bountyId: string): Promise<BountyRow> {
  const [row] = await db
    .select({
      id: bounties.id,
      provider: bounties.provider,
      status: bounties.status,
      deletedAt: bounties.deletedAt,
      repoFullName: repos.fullName,
      hfRepoType: repos.hfRepoType,
    })
    .from(bounties)
    .innerJoin(repos, eq(repos.id, bounties.repoId))
    .where(eq(bounties.id, bountyId))
    .limit(1);
  if (!row) {
    throw new BountyError("bounty_not_found", "Bounty not found.");
  }
  if (row.deletedAt) {
    throw new BountyError("bounty_not_found", "Bounty not found.", null, 410);
  }
  return row;
}

/** Race on the active-user index is the caller's own submission, not a taken pull request. */
export function submissionUniqueConflictMessage(err: unknown): string {
  const constraint = uniqueViolationConstraint(err) ?? "";
  if (constraint.includes("active_user")) {
    return "You already submitted a pull request for this bounty. Withdraw it before submitting another.";
  }
  return "This pull request was already submitted for this bounty.";
}

function assertHuggingFaceSubmissions(bounty: BountyRow, env: NodeJS.ProcessEnv): void {
  if (bounty.provider !== "huggingface") {
    throw new ProviderNotSupportedError(
      bounty.provider,
      "GitHub bounties use the claim flow. Submitting a pull request is only for Hugging Face bounties.",
    );
  }
  if (!hfBountiesEnabled(env)) {
    throw new BountyError(
      "hf_disabled",
      "Hugging Face bounties are disabled. Set HF_BOUNTIES_ENABLED=1 to submit a pull request.",
    );
  }
}

async function bountyHasPaidClaim(db: Database, bountyId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: claims.id })
    .from(claims)
    .where(and(eq(claims.bountyId, bountyId), eq(claims.status, "paid")))
    .limit(1);
  return Boolean(row);
}

export async function listBountySubmissions(
  bountyId: string,
  opts: SubmissionCall,
): Promise<SubmissionView[]> {
  const env = opts.env ?? process.env;
  const bounty = await loadBounty(opts.db, bountyId);
  assertHuggingFaceSubmissions(bounty, env);
  const rows = await opts.db
    .select({
      id: bountySubmissions.id,
      bountyId: bountySubmissions.bountyId,
      userId: bountySubmissions.userId,
      prUrl: bountySubmissions.prUrl,
      prNumber: bountySubmissions.prNumber,
      hfAuthor: bountySubmissions.hfAuthor,
      status: bountySubmissions.status,
      createdAt: bountySubmissions.createdAt,
    })
    .from(bountySubmissions)
    .where(and(eq(bountySubmissions.bountyId, bountyId), eq(bountySubmissions.status, "submitted")))
    .orderBy(asc(bountySubmissions.createdAt));
  return rows.map(toView);
}

export async function submitHuggingFacePr(
  input: { bountyId: string; userId: string; prUrl: string },
  opts: SubmissionCall,
): Promise<SubmissionView> {
  if (!input.userId) {
    throw new BountyError("unauthorized", "Sign in to submit a pull request.");
  }
  const env = opts.env ?? process.env;
  const bounty = await loadBounty(opts.db, input.bountyId);
  assertHuggingFaceSubmissions(bounty, env);
  if (bounty.status !== "funded") {
    throw new BountyError(
      "bounty_not_open",
      `This bounty is ${bounty.status}. Submit a pull request on an open funded Hugging Face bounty.`,
    );
  }

  const [link] = await opts.db
    .select({ hfSub: hfLinks.hfSub, hfUsername: hfLinks.hfUsername })
    .from(hfLinks)
    .where(eq(hfLinks.userId, input.userId))
    .limit(1);
  if (!link?.hfUsername.trim()) {
    throw new BountyError(
      "hf_not_linked",
      "Link Hugging Face before submitting a pull request.",
    );
  }

  const parsed = getProvider("huggingface").parsePrUrl(input.prUrl);
  if (!parsed?.hfRepoType) {
    throw new BountyError(
      "not_a_pull_request",
      "Enter a Hugging Face pull request URL like https://huggingface.co/owner/repo/discussions/12.",
    );
  }

  let discussion;
  try {
    discussion = await fetchHuggingFaceDiscussion(
      {
        provider: "huggingface",
        owner: parsed.owner,
        repo: parsed.repo,
        fullName: parsed.fullName,
        issueNumber: parsed.prNumber,
        url: parsed.url,
        hfRepoType: parsed.hfRepoType,
      },
      { http: opts.http, env },
    );
  } catch (err) {
    if (err instanceof BountyError) throw err;
    if (isHuggingFaceReadError(err)) {
      throw bountyErrorForHuggingFace(err, `${parsed.fullName}#${parsed.prNumber}`);
    }
    throw new BountyError(
      "hf_unavailable",
      `Hugging Face could not be reached for ${parsed.fullName}#${parsed.prNumber}.`,
    );
  }

  if (!discussion.isPullRequest) {
    throw new BountyError(
      "not_a_pull_request",
      `${discussion.fullName}#${parsed.prNumber} is a discussion, not a pull request.`,
    );
  }
  if (!reposMatch(
    { type: discussion.repoType, fullName: discussion.fullName },
    { type: bounty.hfRepoType, fullName: bounty.repoFullName },
  )) {
    throw new BountyError(
      "repo_mismatch",
      `This pull request is in ${discussion.fullName} (${discussion.repoType}), not ${bounty.repoFullName}.`,
    );
  }
  if (discussion.status !== "open" && discussion.status !== "merged") {
    throw new BountyError(
      "pr_closed",
      `This pull request is ${discussion.status || "not open"}. Submit an open or merged pull request.`,
    );
  }
  if (!namesMatch(discussion.authorLogin, link.hfUsername)) {
    throw new BountyError(
      "author_mismatch",
      discussion.authorLogin
        ? `The pull request author ${discussion.authorLogin} does not match your linked Hugging Face username ${link.hfUsername}.`
        : `This pull request has no author and does not match your linked Hugging Face username ${link.hfUsername}.`,
    );
  }

  const prUrl = huggingFaceDiscussionUrl(discussion.repoType, discussion.fullName, parsed.prNumber);
  const hfAuthor = discussion.authorLogin?.trim() || link.hfUsername.trim();

  try {
    const created = await opts.db.transaction(async (tx) => {
      const database = tx as unknown as Database;
      await database.execute(sql`select id from bounties where id = ${bounty.id} for update`);
      const [fresh] = await database
        .select({ status: bounties.status, deletedAt: bounties.deletedAt })
        .from(bounties)
        .where(eq(bounties.id, bounty.id))
        .limit(1);
      if (!fresh) {
        throw new BountyError("bounty_not_found", "Bounty not found.");
      }
      if (fresh.deletedAt) {
        throw new BountyError("bounty_not_found", "Bounty not found.", null, 410);
      }
      if (fresh.status !== "funded") {
        throw new BountyError(
          "bounty_not_open",
          `This bounty is ${fresh.status}. Submit a pull request on an open funded Hugging Face bounty.`,
        );
      }
      const [mine] = await database
        .select({ id: bountySubmissions.id })
        .from(bountySubmissions)
        .where(
          and(
            eq(bountySubmissions.bountyId, bounty.id),
            eq(bountySubmissions.userId, input.userId),
            eq(bountySubmissions.status, "submitted"),
          ),
        )
        .limit(1);
      if (mine) {
        throw new BountyError(
          "already_submitted",
          "You already submitted a pull request for this bounty. Withdraw it before submitting another.",
        );
      }
      const [taken] = await database
        .select({ id: bountySubmissions.id })
        .from(bountySubmissions)
        .where(
          and(
            eq(bountySubmissions.bountyId, bounty.id),
            eq(bountySubmissions.prNumber, parsed.prNumber),
            eq(bountySubmissions.status, "submitted"),
          ),
        )
        .limit(1);
      if (taken) {
        throw new BountyError(
          "already_submitted",
          "This pull request was already submitted for this bounty.",
        );
      }
      const [row] = await database
        .insert(bountySubmissions)
        .values({
          bountyId: bounty.id,
          userId: input.userId,
          provider: "huggingface",
          prNumber: parsed.prNumber,
          prUrl,
          prAuthorProviderId: discussion.authorId,
          hfAuthor,
          status: "submitted",
        })
        .returning({
          id: bountySubmissions.id,
          bountyId: bountySubmissions.bountyId,
          userId: bountySubmissions.userId,
          prUrl: bountySubmissions.prUrl,
          prNumber: bountySubmissions.prNumber,
          hfAuthor: bountySubmissions.hfAuthor,
          status: bountySubmissions.status,
          createdAt: bountySubmissions.createdAt,
        });
      if (!row) throw new Error("insert bounty submission returned no row");
      return row;
    });
    return toView(created);
  } catch (err) {
    if (err instanceof BountyError || err instanceof ProviderNotSupportedError) throw err;
    if (isUniqueViolation(err)) {
      throw new BountyError("already_submitted", submissionUniqueConflictMessage(err));
    }
    throw err;
  }
}

export async function withdrawBountySubmission(
  input: { bountyId: string; userId: string },
  opts: SubmissionCall,
): Promise<{ bountyId: string; id: string; withdrawn: true }> {
  if (!input.userId) {
    throw new BountyError("unauthorized", "Sign in to withdraw a submission.");
  }
  const env = opts.env ?? process.env;
  const bounty = await loadBounty(opts.db, input.bountyId);
  assertHuggingFaceSubmissions(bounty, env);

  return opts.db.transaction(async (tx) => {
    const database = tx as unknown as Database;
    await database.execute(sql`select id from bounties where id = ${bounty.id} for update`);
    const [fresh] = await database
      .select({ status: bounties.status, deletedAt: bounties.deletedAt })
      .from(bounties)
      .where(eq(bounties.id, bounty.id))
      .limit(1);
    if (!fresh) {
      throw new BountyError("bounty_not_found", "Bounty not found.");
    }
    if (fresh.deletedAt) {
      throw new BountyError("bounty_not_found", "Bounty not found.", null, 410);
    }
    if (!submissionWithdrawOpen(fresh.status) || (await bountyHasPaidClaim(database, bounty.id))) {
      throw new BountyError(
        "bounty_paid",
        "This bounty has been paid. Withdraw is closed.",
      );
    }
    const [row] = await database
      .update(bountySubmissions)
      .set({ status: "withdrawn" })
      .where(
        and(
          eq(bountySubmissions.bountyId, bounty.id),
          eq(bountySubmissions.userId, input.userId),
          eq(bountySubmissions.status, "submitted"),
        ),
      )
      .returning({ id: bountySubmissions.id });
    if (!row) {
      throw new BountyError(
        "submission_not_found",
        "You have no active pull request submission on this bounty.",
      );
    }
    return { bountyId: bounty.id, id: row.id, withdrawn: true as const };
  });
}
