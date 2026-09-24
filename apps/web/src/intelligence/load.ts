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
  type IntelligenceCacheRow,
} from "./cache";
import { hasGeminiApiKey, readGeminiModel } from "./env";
import {
  classifyIntelligenceFailure,
  logIntelligenceEvent,
  sanitizeIntelligenceErrorReason,
} from "./errors";
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
      errorReason?: string;
      estimateLabel: string;
    };

export type IntelligenceCachePort = {
  read: (bountyId: string, db: Database) => Promise<IntelligenceCacheRow | null>;
  write: typeof writeIntelligenceCache;
};

export type CachedIntelligenceResult =
  | {
      cached: true;
      status: "ready";
      repoAbout: string;
      languageStack: string;
      complexity: "S" | "M" | "L";
      model: string | null;
      generatedAt: string;
      estimateLabel: string;
    }
  | {
      cached: true;
      status: "error";
      reason: string;
      generatedAt: string;
      estimateLabel: string;
    }
  | {
      cached: false;
      status: "not_cached";
      estimateLabel: string;
    };

/**
 * Cache read for the public API and MCP. Never calls Gemini, never fetches
 * GitHub, and never writes the cache — including when the row is missing,
 * stale, or an error. Callers must not pass this result into
 * {@link loadBountyIntelligence}.
 */
export async function readCachedBountyIntelligence(args: {
  bountyId: string;
  db: Database;
  read?: IntelligenceCachePort["read"];
}): Promise<CachedIntelligenceResult> {
  const read = args.read ?? readIntelligenceCache;
  const estimateLabel = INTELLIGENCE_ESTIMATE_LABEL;
  let row: IntelligenceCacheRow | null = null;
  try {
    row = await read(args.bountyId, args.db);
  } catch (err) {
    const classified = classifyIntelligenceFailure(err);
    logIntelligenceEvent("bounty_intelligence_cache_read_failed", {
      bountyId: args.bountyId,
      error: classified.code,
      pgCode: classified.pgCode,
    });
    return { cached: false, status: "not_cached", estimateLabel };
  }
  if (!row) return { cached: false, status: "not_cached", estimateLabel };
  const generatedAt = row.generatedAt.toISOString();
  if (
    row.status === "ready" &&
    row.repoAbout &&
    row.languageStack &&
    (row.complexity === "S" || row.complexity === "M" || row.complexity === "L")
  ) {
    return {
      cached: true,
      status: "ready",
      repoAbout: row.repoAbout,
      languageStack: row.languageStack,
      complexity: row.complexity,
      model: row.model,
      generatedAt,
      estimateLabel,
    };
  }
  if (row.status === "error") {
    return {
      cached: true,
      status: "error",
      reason: sanitizeIntelligenceErrorReason(row.errorReason) ?? "error",
      generatedAt,
      estimateLabel,
    };
  }
  return { cached: false, status: "not_cached", estimateLabel };
}

const EMPTY_REPO: GitHubRepoContext = {
  description: null,
  language: null,
  languages: [],
  readmeBlurb: null,
};

/**
 * Server-only loader. Cache keyed by bounty; refresh on create (first read),
 * stale TTL (7d ready / 1h error), source fingerprint change, or forceRefresh.
 * Cache read/write failures (e.g. missing `bounty_intelligence` table) are
 * logged and must not crash the bounty page.
 */
export async function loadBountyIntelligence(args: {
  bountyId: string;
  repoFullName: string;
  githubIssueNumber: number;
  issueTitle: string;
  issueBody: string | null;
  installationId: bigint | null;
  db: Database;
  forceRefresh?: boolean;
  now?: Date;
  env?: EnvMap;
  githubHttp?: GitHubHttp;
  geminiHttp?: GeminiHttp;
  cache?: IntelligenceCachePort;
}): Promise<IntelligenceView> {
  const env = args.env ?? process.env;
  const estimateLabel = INTELLIGENCE_ESTIMATE_LABEL;
  const cache = args.cache ?? { read: readIntelligenceCache, write: writeIntelligenceCache };
  if (!hasGeminiApiKey(env)) {
    return { status: "unavailable", reason: "missing_key", errorReason: "missing_key", estimateLabel };
  }

  const now = args.now ?? new Date();
  const model = readGeminiModel(env);
  const repo = await loadRepoContext(args);
  const fingerprint = intelligenceFingerprint({
    issueBody: args.issueBody,
    repoAbout: repo.description,
    languages: repo.languages,
    readmeBlurb: repo.readmeBlurb,
  });

  if (!args.forceRefresh) {
    const cachedView = await readFreshCacheView({
      bountyId: args.bountyId,
      db: args.db,
      fingerprint,
      now,
      estimateLabel,
      read: cache.read,
    });
    if (cachedView) return cachedView;
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

  if (!generated.ok) {
    logIntelligenceEvent("bounty_intelligence_gemini_failed", {
      bountyId: args.bountyId,
      error: generated.error,
      model,
    });
  }

  try {
    if (generated.ok) {
      await cache.write(args.db, {
        bountyId: args.bountyId,
        fingerprint,
        generatedAt: now,
        status: "ready",
        output: generated.output,
        model: generated.model,
      });
      return toReadyView(generated.output, generated.model, now, estimateLabel);
    }
    await cache.write(args.db, {
      bountyId: args.bountyId,
      fingerprint,
      generatedAt: now,
      status: "error",
      errorReason: generated.error,
      model,
    });
  } catch (err) {
    const classified = classifyIntelligenceFailure(err);
    logIntelligenceEvent("bounty_intelligence_cache_write_failed", {
      bountyId: args.bountyId,
      error: classified.code,
      pgCode: classified.pgCode,
      model,
    });
    if (generated.ok) {
      return toReadyView(generated.output, generated.model, now, estimateLabel);
    }
    return unavailableError(
      classified.code === "missing_table" ? "missing_table" : generated.error,
      estimateLabel,
    );
  }

  return unavailableError(generated.error, estimateLabel);
}

async function readFreshCacheView(args: {
  bountyId: string;
  db: Database;
  fingerprint: string;
  now: Date;
  estimateLabel: string;
  read: IntelligenceCachePort["read"];
}): Promise<IntelligenceView | null> {
  try {
    const cached = await args.read(args.bountyId, args.db);
    if (!cached || !cacheIsFresh({ row: cached, fingerprint: args.fingerprint, now: args.now })) {
      return null;
    }
    if (cached.status === "ready" && cached.repoAbout && cached.languageStack && cached.complexity) {
      return {
        status: "ready",
        repoAbout: cached.repoAbout,
        languageStack: cached.languageStack,
        complexity: cached.complexity as "S" | "M" | "L",
        model: cached.model ?? "",
        generatedAt: cached.generatedAt,
        estimateLabel: args.estimateLabel,
      };
    }
    if (cached.status === "error") {
      return unavailableError(cached.errorReason, args.estimateLabel);
    }
    return null;
  } catch (err) {
    const classified = classifyIntelligenceFailure(err);
    logIntelligenceEvent("bounty_intelligence_cache_read_failed", {
      bountyId: args.bountyId,
      error: classified.code,
      pgCode: classified.pgCode,
    });
    return null;
  }
}

function unavailableError(
  errorReason: string | null | undefined,
  estimateLabel: string,
): IntelligenceView {
  return {
    status: "unavailable",
    reason: "error",
    errorReason: sanitizeIntelligenceErrorReason(errorReason) ?? "error",
    estimateLabel,
  };
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
  installationId: bigint | null;
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
