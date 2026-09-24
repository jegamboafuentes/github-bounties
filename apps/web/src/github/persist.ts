import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { githubLinks, repos } from "../db/schema";
import type { GitHubIdentity, InstallationRepo } from "./api";

export type GithubLinkRow = typeof githubLinks.$inferSelect;
export type RepoRow = typeof repos.$inferSelect;

export async function findGithubLinkByIdOrLogin(
  db: Database,
  identity: { githubId?: number | bigint | null; githubLogin?: string | null },
): Promise<Pick<GithubLinkRow, "userId" | "githubId" | "githubLogin"> | null> {
  if (identity.githubId != null) {
    const [byId] = await db
      .select({
        userId: githubLinks.userId,
        githubId: githubLinks.githubId,
        githubLogin: githubLinks.githubLogin,
      })
      .from(githubLinks)
      .where(eq(githubLinks.githubId, BigInt(identity.githubId)))
      .limit(1);
    if (byId) return byId;
  }

  const login = identity.githubLogin?.trim();
  if (!login) return null;
  const [byLogin] = await db
    .select({
      userId: githubLinks.userId,
      githubId: githubLinks.githubId,
      githubLogin: githubLinks.githubLogin,
    })
    .from(githubLinks)
    .where(sql`lower(${githubLinks.githubLogin}) = ${login.toLowerCase()}`)
    .limit(1);
  return byLogin ?? null;
}

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

export async function findActiveRepoByFullName(
  fullName: string,
  db: Database,
): Promise<RepoRow | null> {
  const [row] = await db
    .select()
    .from(repos)
    .where(
      and(
        sql`lower(${repos.fullName}) = ${fullName.toLowerCase()}`,
        eq(repos.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Delete the signed-in user's `github_links` row only.
 * Does not touch `users`, `repos`, bounties, or claims.
 * GitHub App installations stay on `repos` (shared by `installation_id`).
 */
export async function deleteGithubLinkByUserId(
  userId: string,
  db: Database,
): Promise<GithubLinkRow | null> {
  const [row] = await db
    .delete(githubLinks)
    .where(eq(githubLinks.userId, userId))
    .returning();
  return row ?? null;
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
        connectionKind: "app_install",
        connectedByUserId: args.userId,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: repos.githubRepoId,
        set: {
          fullName: repo.fullName,
          installationId: args.installationId,
          connectionKind: "app_install",
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
      .set({
        isActive: false,
        connectionKind: "public_reference",
        installationId: null,
        updatedAt: new Date(),
      })
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
    .set({
      isActive: false,
      connectionKind: "public_reference",
      installationId: null,
      updatedAt: new Date(),
    })
    .where(eq(repos.installationId, BigInt(installationId)))
    .returning({ id: repos.id });
  return rows.length;
}

/**
 * Remember a public repo the poster referenced. Does not require an App install.
 * An active `app_install` row for the same `github_repo_id` is left in place so
 * webhooks keep ownership. Inactive installs become `public_reference` so the
 * merge poller can see funded bounties again.
 */
export async function upsertPublicReferenceRepo(args: {
  userId: string;
  githubRepoId: bigint;
  fullName: string;
  db: Database;
}): Promise<RepoRow> {
  const write = async (): Promise<RepoRow> => {
    const [existing] = await args.db
      .select()
      .from(repos)
      .where(eq(repos.githubRepoId, args.githubRepoId))
      .limit(1);

    if (
      existing &&
      existing.connectionKind === "app_install" &&
      existing.isActive &&
      existing.installationId != null
    ) {
      if (existing.fullName === args.fullName) return existing;
      const [renamed] = await args.db
        .update(repos)
        .set({ fullName: args.fullName, updatedAt: new Date() })
        .where(eq(repos.id, existing.id))
        .returning();
      return renamed ?? existing;
    }

    if (!existing) {
      const [inserted] = await args.db
        .insert(repos)
        .values({
          githubRepoId: args.githubRepoId,
          fullName: args.fullName,
          installationId: null,
          connectionKind: "public_reference",
          connectedByUserId: args.userId,
          isActive: true,
        })
        .returning();
      if (!inserted) throw new Error("insert public reference repo returned no row");
      return inserted;
    }

    const [updated] = await args.db
      .update(repos)
      .set({
        fullName: args.fullName,
        installationId: null,
        connectionKind: "public_reference",
        connectedByUserId: args.userId,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(repos.id, existing.id))
      .returning();
    if (!updated) throw new Error("update public reference repo returned no row");
    return updated;
  };

  try {
    return await write();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return write();
  }
}
