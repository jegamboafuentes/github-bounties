import type { Database } from "../db/client";
import type { EnvMap } from "../auth/env";
import {
  fetchRepoContext,
  type GitHubHttp,
  type GitHubRepoContext,
} from "../github/api";
import { splitFullName } from "../bounties/issue-body";
import {
  cacheIsFresh,
  intelligenceFingerprint,
  readIntelligenceCache,
  writeIntelligenceCache,
} from "./cache";
import { hasGeminiApiKey } from "./env";
import { generateBountyIntelligence, type GeminiHttp } from "./gemini";
import {
  buildIntelligencePrompt,
  INTELLIGENCE_ESTIMATE_LABEL,
  type IntelligenceModelOutput,
} from "./prompt";

export type IntelligenceView =
  | {
      status: "ready";
      repoAbout: string;
      languageStack: string;
      complexity: "S" | "M" | "L";
      model: string;
      generatedAt: Date;
      estimateLabel: string;
    }
  | {
      status: "unavailable";
      reason: "missing_key" | "error";
      estimateLabel: string;
    };

const EMPTY_REPO: GitHubRepoContext = {
  description: null,
  language: null,
  languages: [],
  readmeBlurb: null,
};

/**
 * Server-only loader. Cache keyed by bounty; refresh on create (first read),
 * stale TTL (7d ready / 1h error), source fingerprint change, or forceRefresh.
 */
export async function loadBountyIntelligence(args: {
  bountyId: string;
  repoFullName: string;
  githubIssueNumber: number;
  issueTitle: string;
  issueBody: string | null;
  installationId: bigint;
  db: Database;
  forceRefresh?: boolean;
  now?: Date;
  env?: EnvMap;
  githubHttp?: GitHubHttp;
  geminiHttp?: GeminiHttp;
}): Promise<IntelligenceView> {
  const env = args.env ?? process.env;
  const estimateLabel = INTELLIGENCE_ESTIMATE_LABEL;
  if (!hasGeminiApiKey(env)) {
    return { status: "unavailable", reason: "missing_key", estimateLabel };
  }

  const now = args.now ?? new Date();
  const repo = await loadRepoContext(args);
  const fingerprint = intelligenceFingerprint({
    issueBody: args.issueBody,
    repoAbout: repo.description,
    languages: repo.languages,
    readmeBlurb: repo.readmeBlurb,
  });

  if (!args.forceRefresh) {
    const cached = await readIntelligenceCache(args.bountyId, args.db);
    if (cached && cacheIsFresh({ row: cached, fingerprint, now })) {
      if (cached.status === "ready" && cached.repoAbout && cached.languageStack && cached.complexity) {
        return {
          status: "ready",
          repoAbout: cached.repoAbout,
          languageStack: cached.languageStack,
          complexity: cached.complexity as "S" | "M" | "L",
          model: cached.model ?? "",
          generatedAt: cached.generatedAt,
          estimateLabel,
        };
      }
      if (cached.status === "error") {
        return { status: "unavailable", reason: "error", estimateLabel };
      }
    }
  }

  const prompt = buildIntelligencePrompt({
    repoFullName: args.repoFullName,
    issueNumber: args.githubIssueNumber,
    issueTitle: args.issueTitle,
    issueBody: args.issueBody,
    repo,
  });
  const generated = await generateBountyIntelligence({
    prompt,
    env,
    http: args.geminiHttp,
  });

  try {
    if (generated.ok) {
      await writeIntelligenceCache(args.db, {
        bountyId: args.bountyId,
        fingerprint,
        generatedAt: now,
        status: "ready",
        output: generated.output,
        model: generated.model,
      });
      return toReadyView(generated.output, generated.model, now, estimateLabel);
    }
    await writeIntelligenceCache(args.db, {
      bountyId: args.bountyId,
      fingerprint,
      generatedAt: now,
      status: "error",
      errorReason: generated.error,
    });
  } catch {
    // Cache write must not crash the bounty page.
  }

  return { status: "unavailable", reason: "error", estimateLabel };
}

function toReadyView(
  output: IntelligenceModelOutput,
  model: string,
  generatedAt: Date,
  estimateLabel: string,
): IntelligenceView {
  return {
    status: "ready",
    repoAbout: output.repoAbout,
    languageStack: output.languageStack,
    complexity: output.complexity,
    model,
    generatedAt,
    estimateLabel,
  };
}

async function loadRepoContext(args: {
  repoFullName: string;
  installationId: bigint;
  githubHttp?: GitHubHttp;
}): Promise<GitHubRepoContext> {
  const [owner, repo] = splitFullName(args.repoFullName);
  if (!owner || !repo) return EMPTY_REPO;
  try {
    return await fetchRepoContext(owner, repo, {
      installationId: args.installationId,
      http: args.githubHttp,
    });
  } catch {
    return EMPTY_REPO;
  }
}
