/**
 * Shared loader for `fixtures/pool-eligibility-cases.json`.
 * V2-0 evaluates the predicate; V2-2 maps the same cases onto freeze rows.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolEligibilityInput, PoolPullRequest } from "./pool-eligibility";

export type PoolFixtureActor = { login: string; githubId: number };

export type PoolFixtureHunterSeed = {
  login: string;
  githubId: number;
  prNumber: number;
  createdAt: string;
  body?: string;
  title?: string;
};

export type PoolFixtureCase = {
  id: string;
  description: string;
  bountyStatus?: string;
  expectedInE: string[];
  expectedOverflow: string[];
  pullRequests?: PoolPullRequest[];
  qualifyingHunters?: PoolFixtureHunterSeed[];
  winningPrOverrides?: Partial<PoolPullRequest>;
  assertNotV1WinnerCloser?: boolean;
};

export type PoolFixtureFile = {
  meta: {
    bountyIssueNumber: number;
    repositoryFullName: string;
    bountyStatus: string;
    mergedAt: string;
    poster: PoolFixtureActor;
    winner: PoolFixtureActor;
    winningPr: PoolPullRequest;
  };
  ticketIds: string[];
  cases: PoolFixtureCase[];
};

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/pool-eligibility-cases.json",
);

let cached: PoolFixtureFile | undefined;

export function loadPoolEligibilityFixtures(): PoolFixtureFile {
  if (!cached) {
    cached = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as PoolFixtureFile;
  }
  return cached;
}

export function qualifyingPrFromSeed(
  seed: PoolFixtureHunterSeed,
  repo: string,
): PoolPullRequest {
  return {
    number: seed.prNumber,
    title: seed.title ?? "Hunt",
    body: seed.body ?? "Refs #42",
    authorLogin: seed.login,
    authorId: seed.githubId,
    authorType: "User",
    createdAt: seed.createdAt,
    draft: false,
    merged: false,
    closed: false,
    baseRepositoryFullName: repo,
    headRepositoryFullName: `${seed.login}/repo`,
    commitAuthorsAtFreeze: [{ login: seed.login, githubId: seed.githubId }],
    commitMessages: ["wip"],
  };
}

export function poolEligibilityInputForCase(
  row: PoolFixtureCase,
  fixtures: PoolFixtureFile = loadPoolEligibilityFixtures(),
): PoolEligibilityInput {
  const { meta } = fixtures;
  const winningPr = {
    ...meta.winningPr,
    ...(row.winningPrOverrides ?? {}),
  };
  const extra = [
    ...(row.pullRequests ?? []),
    ...(row.qualifyingHunters ?? []).map((h) =>
      qualifyingPrFromSeed(h, meta.repositoryFullName),
    ),
  ];
  return {
    bounty: {
      issueNumber: meta.bountyIssueNumber,
      repositoryFullName: meta.repositoryFullName,
      status: row.bountyStatus ?? meta.bountyStatus,
      poster: meta.poster,
    },
    winner: meta.winner,
    winningMerge: {
      prNumber: winningPr.number,
      mergedAt: meta.mergedAt,
    },
    pullRequests: [winningPr, ...extra],
  };
}
