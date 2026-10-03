import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { repos, type HfRepoType } from "../db/schema";
import { hfProviderRepoId } from "./huggingface";

type RepoRow = typeof repos.$inferSelect;

/**
 * Remember a public Hugging Face repo. `github_repo_id` stays null.
 * The row is keyed by repo type plus `owner/name` (`dataset:owner/name`).
 */
export async function upsertHuggingFaceRepo(args: {
  userId: string;
  hfRepoType: HfRepoType;
  fullName: string;
  db: Database;
}): Promise<RepoRow> {
  const providerRepoId = hfProviderRepoId(args.hfRepoType, args.fullName);
  const write = async (): Promise<RepoRow> => {
    const [existing] = await args.db
      .select()
      .from(repos)
      .where(and(eq(repos.provider, "huggingface"), eq(repos.providerRepoId, providerRepoId)))
      .limit(1);

    if (!existing) {
      const [inserted] = await args.db
        .insert(repos)
        .values({
          githubRepoId: null,
          provider: "huggingface",
          providerRepoId,
          hfRepoType: args.hfRepoType,
          fullName: args.fullName,
          installationId: null,
          connectionKind: "public_reference",
          connectedByUserId: args.userId,
          isActive: true,
        })
        .returning();
      if (!inserted) throw new Error("insert huggingface repo returned no row");
      return inserted;
    }

    const [updated] = await args.db
      .update(repos)
      .set({
        fullName: args.fullName,
        hfRepoType: args.hfRepoType,
        providerRepoId,
        installationId: null,
        connectionKind: "public_reference",
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(repos.id, existing.id))
      .returning();
    if (!updated) throw new Error("update huggingface repo returned no row");
    return updated;
  };

  try {
    return await write();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return write();
  }
}
