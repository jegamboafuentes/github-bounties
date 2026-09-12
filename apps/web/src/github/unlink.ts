import type { Database } from "../db/client";
import { deleteGithubLinkByUserId } from "./persist";

/** Soft notice after Settings → Disconnect. Hunter must reconnect to match merge authors. */
export const DISCONNECT_GITHUB_NOTICE = "Connect GitHub to claim merge payouts.";

export type UnlinkGithubResult = {
  deleted: boolean;
  githubLogin: string | null;
};

/**
 * Unlink GitHub for one Google user. Scoped to `userId` (session user).
 *
 * Clears `github_links` only. Does not delete the Google `users` row, cascade
 * bounties/claims, or revoke a GitHub App installation on `repos`.
 */
export async function unlinkGithubForUser(
  userId: string,
  db: Database,
): Promise<UnlinkGithubResult> {
  if (!userId) {
    throw new Error("userId is required to unlink GitHub.");
  }
  const row = await deleteGithubLinkByUserId(userId, db);
  return {
    deleted: Boolean(row),
    githubLogin: row?.githubLogin ?? null,
  };
}
