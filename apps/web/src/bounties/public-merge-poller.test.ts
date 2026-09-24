import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Database } from "../db/client";
import { bountyErrorForPublicRead, createBountyFromIssueUrl } from "./create";
import { BountyError } from "./errors";
import { closingPullToWebhookPayload, publicMergeDeliveryId } from "./public-merge-poller";
import { PublicGitHubError } from "../github/public-read";
import { evaluateEligibility } from "../webhooks/eligibility";
import { toEligibilityInput } from "../webhooks/input";
import type { PublicClosingPull } from "../github/public-read";

function pull(overrides: Partial<PublicClosingPull> = {}): PublicClosingPull {
  return {
    number: 12,
    title: "Update samples",
    body: "Fixes #1080",
    merged: true,
    authorLogin: "ada",
    authorId: 42,
    baseRef: "main",
    defaultBranch: "main",
    mergedAt: "2026-09-24T00:00:00Z",
    mergeCommitSha: "abc",
    ...overrides,
  };
}

describe("public merge payload", () => {
  it("matches evaluateEligibility for a default-branch close", () => {
    const payload = closingPullToWebhookPayload("android/architecture-samples", pull());
    const decision = evaluateEligibility(toEligibilityInput("pull_request", payload));
    assert.equal(decision.eligible, true);
    assert.deepEqual(decision.closedIssueNumbers, [1080]);
    assert.equal(decision.winnerLogin, "ada");
    assert.equal(decision.winnerId, 42);
    assert.equal(
      publicMergeDeliveryId("Android/architecture-samples", 12),
      "public-merge:android/architecture-samples#12",
    );
  });

  it("rejects a merge that missed the default branch or a closing keyword", () => {
    const offDefault = evaluateEligibility(
      toEligibilityInput(
        "pull_request",
        closingPullToWebhookPayload("octo/hello", pull({ baseRef: "release", body: "Fixes #4" })),
      ),
    );
    assert.equal(offDefault.eligible, false);

    const mention = evaluateEligibility(
      toEligibilityInput(
        "pull_request",
        closingPullToWebhookPayload("octo/hello", pull({ body: "Refs #4", title: "Note" })),
      ),
    );
    assert.equal(mention.eligible, false);
  });

  it("honors GraphQL linked issues the same way webhooks do", () => {
    const decision = evaluateEligibility(
      toEligibilityInput(
        "pull_request",
        closingPullToWebhookPayload(
          "octo/hello",
          pull({ title: "sidebar link", body: "", closingIssueNumbers: [4] }),
        ),
      ),
    );
    assert.equal(decision.eligible, true);
    assert.deepEqual(decision.closedIssueNumbers, [4]);
  });
});

describe("createBountyFromIssueUrl URL gate", () => {
  it("rejects a pull-request URL before any database or GitHub call", async () => {
    await assert.rejects(
      () =>
        createBountyFromIssueUrl(
          {
            posterUserId: "user",
            issueUrl: "https://github.com/octo/hello/pull/12",
            amountUsdc: "10",
          },
          { db: {} as Database },
        ),
      (err: unknown) => err instanceof BountyError && err.code === "invalid_issue_url",
    );
  });
});

describe("bountyErrorForPublicRead", () => {
  it("uses explicit copy for not found, private, rate limit, and pull requests", () => {
    const ref = "android/architecture-samples";
    assert.equal(
      bountyErrorForPublicRead(new PublicGitHubError("not_found", 404, "Not Found"), ref, 1080).code,
      "issue_not_found",
    );
    assert.match(
      bountyErrorForPublicRead(new PublicGitHubError("inaccessible", 403, "nope"), ref, 1080).message,
      /private or inaccessible/,
    );
    assert.match(
      bountyErrorForPublicRead(new PublicGitHubError("rate_limited", 403, "API rate limit exceeded"), ref, 1080)
        .message,
      /GITHUB_PUBLIC_READ_TOKEN/,
    );
    assert.equal(
      bountyErrorForPublicRead(new PublicGitHubError("not_an_issue", 200, "pr"), ref, 1080).code,
      "not_an_issue",
    );
  });
});
