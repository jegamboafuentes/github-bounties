import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, repos } from "../db/schema";
import {
  fetchIssue,
  type GitHubHttp,
  type GitHubIssueSnapshot,
} from "../github/api";
import { resolvePublicIssue } from "../github/public-read";
import {
  clipIssueBody,
  looksLegacyClippedBody,
} from "./markdown";

/** Refetch GitHub issue body after this TTL so hunters see edits. */
export const ISSUE_BODY_TTL_MS = 24 * 60 * 60 * 1000;

export type BountyIssueBody = {
  markdown: string | null;
  title: string | null;
  refreshed: boolean;
  repoFullName: string;
  githubIssueNumber: number;
  installationId: bigint | null;
};

export function shouldRefreshIssueBody(args: {
  snapshot: string | null;
  syncedAt: Date | null;
  now?: Date;
}): boolean {
  if (!args.snapshot) return true;
  if (looksLegacyClippedBody(args.snapshot)) return true;
  if (!args.syncedAt) return true;
  const now = args.now ?? new Date();
  return now.getTime() - args.syncedAt.getTime() > ISSUE_BODY_TTL_MS;
}

/**
 * Load the full GitHub issue body for the bounty detail page.
 * Uses the stored snapshot when fresh; otherwise fetches via the App
 * installation token or public REST when the repo has no installation.
 * Never throws — falls back to snapshot.
 */
export async function loadBountyIssueBody(
  bountyId: string,
  db: Database,
  opts: { http?: GitHubHttp; jwt?: string; now?: Date } = {},
): Promise<BountyIssueBody | null> {
  const [row] = await db
    .select({
      descriptionSnapshot: bounties.descriptionSnapshot,
      issueBodySyncedAt: bounties.issueBodySyncedAt,
      title: bounties.title,
      githubIssueNumber: bounties.githubIssueNumber,
      repoFullName: repos.fullName,
      installationId: repos.installationId,
    })
    .from(bounties)
    .innerJoin(repos, eq(repos.id, bounties.repoId))
    .where(eq(bounties.id, bountyId))
    .limit(1);

  if (!row) return null;

  const now = opts.now ?? new Date();
  const needsFetch = shouldRefreshIssueBody({
    snapshot: row.descriptionSnapshot,
    syncedAt: row.issueBodySyncedAt,
    now,
  });

  if (!needsFetch) {
    return {
      markdown: row.descriptionSnapshot,
      title: row.title,
      refreshed: false,
      repoFullName: row.repoFullName,
      githubIssueNumber: row.githubIssueNumber,
      installationId: row.installationId,
    };
  }

  const [owner, repo] = splitFullName(row.repoFullName);
  if (!owner || !repo) {
    return {
      markdown: row.descriptionSnapshot,
      title: row.title,
      refreshed: false,
      repoFullName: row.repoFullName,
      githubIssueNumber: row.githubIssueNumber,
      installationId: row.installationId,
    };
  }

  try {
    const snapshot = await loadIssueSnapshot(owner, repo, row.githubIssueNumber, {
      installationId: row.installationId,
      http: opts.http,
      jwt: opts.jwt,
    });
    const markdown = clipIssueBody(snapshot.body);
    const title = snapshot.title.trim() || row.title;
    await db
      .update(bounties)
      .set({
        descriptionSnapshot: markdown,
        issueBodySyncedAt: now,
        title,
      })
      .where(eq(bounties.id, bountyId));
    return {
      markdown,
      title,
      refreshed: true,
      repoFullName: row.repoFullName,
      githubIssueNumber: row.githubIssueNumber,
      installationId: row.installationId,
    };
  } catch {
    return {
      markdown: row.descriptionSnapshot,
      title: row.title,
      refreshed: false,
      repoFullName: row.repoFullName,
      githubIssueNumber: row.githubIssueNumber,
      installationId: row.installationId,
    };
  }
}

async function loadIssueSnapshot(
  owner: string,
  repo: string,
  issueNumber: number,
  opts: { installationId: bigint | null; http?: GitHubHttp; jwt?: string },
): Promise<GitHubIssueSnapshot> {
  if (opts.installationId != null) {
    return fetchIssue(owner, repo, issueNumber, {
      installationId: opts.installationId,
      http: opts.http,
      jwt: opts.jwt,
    });
  }
  const resolved = await resolvePublicIssue(owner, repo, issueNumber, { http: opts.http });
  return resolved.issue;
}

export function splitFullName(fullName: string): [string, string] | [null, null] {
  const [owner, repo, ...rest] = fullName.split("/");
  if (!owner || !repo || rest.length) return [null, null];
  return [owner, repo];
}
