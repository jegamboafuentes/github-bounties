import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { bountyIntelligence } from "../db/schema";
import type { IntelligenceModelOutput } from "./prompt";

export const INTELLIGENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INTELLIGENCE_ERROR_TTL_MS = 60 * 60 * 1000;

export type IntelligenceCacheRow = typeof bountyIntelligence.$inferSelect;

export function intelligenceFingerprint(input: {
  issueBody: string | null;
  repoAbout: string | null;
  languages: string[];
  readmeBlurb: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        issueBody: input.issueBody ?? "",
        repoAbout: input.repoAbout ?? "",
        languages: input.languages,
        readme: input.readmeBlurb ?? "",
      }),
    )
    .digest("hex");
}

export function cacheIsFresh(args: {
  row: Pick<IntelligenceCacheRow, "status" | "generatedAt" | "sourceFingerprint">;
  fingerprint: string;
  now?: Date;
}): boolean {
  if (args.row.sourceFingerprint !== args.fingerprint) return false;
  const now = args.now ?? new Date();
  const age = now.getTime() - args.row.generatedAt.getTime();
  if (args.row.status === "error") return age < INTELLIGENCE_ERROR_TTL_MS;
  return age < INTELLIGENCE_TTL_MS;
}

export async function readIntelligenceCache(
  bountyId: string,
  db: Database,
): Promise<IntelligenceCacheRow | null> {
  const [row] = await db
    .select()
    .from(bountyIntelligence)
    .where(eq(bountyIntelligence.bountyId, bountyId))
    .limit(1);
  return row ?? null;
}

export async function writeIntelligenceCache(
  db: Database,
  args: {
    bountyId: string;
    fingerprint: string;
    generatedAt: Date;
  } & (
    | { status: "ready"; output: IntelligenceModelOutput; model: string }
    | { status: "error"; errorReason: string; model?: string }
  ),
): Promise<void> {
  const values = {
    bountyId: args.bountyId,
    sourceFingerprint: args.fingerprint,
    generatedAt: args.generatedAt,
    status: args.status,
    repoAbout: args.status === "ready" ? args.output.repoAbout : null,
    languageStack: args.status === "ready" ? args.output.languageStack : null,
    complexity: args.status === "ready" ? args.output.complexity : null,
    model: args.status === "ready" ? args.model : args.model ?? null,
    errorReason: args.status === "error" ? args.errorReason : null,
  };

  await db
    .insert(bountyIntelligence)
    .values(values)
    .onConflictDoUpdate({
      target: bountyIntelligence.bountyId,
      set: {
        sourceFingerprint: values.sourceFingerprint,
        generatedAt: values.generatedAt,
        status: values.status,
        repoAbout: values.repoAbout,
        languageStack: values.languageStack,
        complexity: values.complexity,
        model: values.model,
        errorReason: values.errorReason,
      },
    });
}
