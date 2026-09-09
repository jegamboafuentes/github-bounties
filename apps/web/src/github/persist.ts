import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { githubLinks, repos } from "../db/schema";
import type { GitHubIdentity, InstallationRepo } from "./api";

export type GithubLinkRow = typeof githubLinks.$inferSelect;
export type RepoRow = typeof repos.$inferSelect;

export async function findGithubLinkByUserId(
  userId: string,
  db: Database,
): Promise<GithubLinkRow | null> {
  const [row] = await db
    .select()
    .from(githubLinks)
    .where(eq(githubLinks.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function listReposForUser(
  userId: string,
  db: Database,
): Promise<RepoRow[]> {
  return db
    .select()
    .from(repos)
    .where(and(eq(repos.connectedByUserId, userId), eq(repos.isActive, true)));
}

export async function upsertGithubLink(
  userId: string,
  identity: GitHubIdentity,
  db: Database,
): Promise<GithubLinkRow> {
  const [row] = await db
    .insert(githubLinks)
    .values({
      userId,
      githubId: identity.githubId,
      githubLogin: identity.githubLogin,
      githubAvatarUrl: identity.githubAvatarUrl ?? null,
    })
    .onConflictDoUpdate({
      target: githubLinks.userId,
      set: {
        githubId: identity.githubId,
        githubLogin: identity.githubLogin,
        githubAvatarUrl: identity.githubAvatarUrl ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) {
    throw new Error("upsert github_links returned no row");
  }
  return row;
}

export async function upsertInstallationRepos(args: {
  userId: string;
  installationId: bigint;
  repositories: InstallationRepo[];
  db: Database;
}): Promise<RepoRow[]> {
  const saved: RepoRow[] = [];
  for (const repo of args.repositories) {
    const [row] = await args.db
      .insert(repos)
      .values({
        githubRepoId: repo.githubRepoId,
        fullName: repo.fullName,
        installationId: args.installationId,
        connectedByUserId: args.userId,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: repos.githubRepoId,
        set: {
          fullName: repo.fullName,
          installationId: args.installationId,
          connectedByUserId: args.userId,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (row) saved.push(row);
  }

  if (args.repositories.length > 0) {
    const keepIds = args.repositories.map((r) => r.githubRepoId);
    await args.db
      .update(repos)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(repos.installationId, args.installationId),
          sql`${repos.githubRepoId} not in (${sql.join(
            keepIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      );
  }

  return saved;
}

export async function deactivateReposForInstallation(
  installationId: number,
  db: Database,
): Promise<number> {
  const rows = await db
    .update(repos)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(repos.installationId, BigInt(installationId)))
    .returning({ id: repos.id });
  return rows.length;
}
