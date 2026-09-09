import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { memoryDeliveryRecorder } from "./delivery-store";
import { handleGitHubWebhookRequest } from "./http";
import { processDelivery } from "./process-delivery";
import type { ClaimWriteResult, GitHubWebhookPayload } from "./types";
import { githubSignature256 } from "./verify-signature";

const fixture = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../fixtures/pull-request-merged-fixes.json",
    ),
    "utf8",
  ),
) as {
  deliveryId: string;
  event: string;
  payload: GitHubWebhookPayload;
};

const SECRET = "test-webhook-secret";

describe("processDelivery", () => {
  it("is eligible on a merged Fixes #N PR", async () => {
    const logs: string[] = [];
    const result = await processDelivery({
      deliveryId: fixture.deliveryId,
      event: fixture.event,
      payload: fixture.payload,
      deps: { store: memoryDeliveryRecorder(), log: (line) => logs.push(line) },
    });
    assert.equal(result.duplicate, false);
    assert.equal(result.decision?.eligible, true);
    assert.deepEqual(result.decision?.closedIssueNumbers, [42]);
    assert.equal(result.decision?.winnerLogin, "octocat");
    assert.match(logs.join("\n"), /would mark claim eligible/);
    assert.match(logs.join("\n"), /issue=#42/);
  });

  it("does not double-write on the same delivery id", async () => {
    const logs: string[] = [];
    const store = memoryDeliveryRecorder();
    const written: ClaimWriteResult[][] = [];
    const deps = {
      store,
      log: (line: string) => logs.push(line),
      claims: {
        async markEligible() {
          const row = [{ issueNumber: 42, claimId: "claim-1", status: "eligible" }];
          written.push(row);
          return row;
        },
      },
    };

    const first = await processDelivery({
      deliveryId: fixture.deliveryId,
      event: fixture.event,
      payload: fixture.payload,
      deps,
    });
    const second = await processDelivery({
      deliveryId: fixture.deliveryId,
      event: fixture.event,
      payload: fixture.payload,
      deps,
    });

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(written.length, 1);
    assert.equal(logs.filter((line) => line.includes("skip duplicate delivery")).length, 1);
    assert.equal(logs.filter((line) => line.includes("marked claim eligible")).length, 1);
  });

  it("does not mark eligibility for a closed-but-unmerged PR", async () => {
    const logs: string[] = [];
    const payload: GitHubWebhookPayload = structuredClone(fixture.payload);
    if (payload.pull_request) payload.pull_request.merged = false;
    const result = await processDelivery({
      deliveryId: "unmerged-1",
      event: "pull_request",
      payload,
      deps: { store: memoryDeliveryRecorder(), log: (line) => logs.push(line) },
    });
    assert.equal(result.decision?.eligible, false);
    assert.equal(logs.some((line) => line.includes("mark claim eligible")), false);
  });
});

describe("handleGitHubWebhookRequest", () => {
  it("returns 503 when the webhook secret is missing", async () => {
    const result = await handleGitHubWebhookRequest({
      rawBody: Buffer.from("{}"),
      secret: "",
      deps: { store: memoryDeliveryRecorder() },
    });
    assert.equal(result.status, 503);
    assert.equal(result.body.error, "missing_github_webhook_secret");
  });

  it("rejects an unsigned body", async () => {
    const result = await handleGitHubWebhookRequest({
      rawBody: Buffer.from("{}"),
      secret: SECRET,
      deliveryId: "unsigned",
      event: "ping",
      deps: { store: memoryDeliveryRecorder() },
    });
    assert.equal(result.status, 401);
  });

  it("accepts GitHub's official signed payload bytes (non-JSON body → 400 after verify)", async () => {
    const vector = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../../../../fixtures/github-official-signature.json",
        ),
        "utf8",
      ),
    ) as { secret: string; payload: string; signature256: string };

    const result = await handleGitHubWebhookRequest({
      rawBody: Buffer.from(vector.payload, "utf8"),
      signatureHeader: vector.signature256,
      secret: vector.secret,
      deliveryId: "official-vector",
      event: "ping",
      deps: { store: memoryDeliveryRecorder() },
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "invalid json");
  });

  it("is idempotent on replay of the same X-GitHub-Delivery", async () => {
    const store = memoryDeliveryRecorder();
    const body = Buffer.from(JSON.stringify(fixture.payload), "utf8");
    const signature = githubSignature256(body, SECRET);
    const deps = { store, log: () => {} };

    const first = await handleGitHubWebhookRequest({
      rawBody: body,
      signatureHeader: signature,
      secret: SECRET,
      deliveryId: fixture.deliveryId,
      event: fixture.event,
      deps,
    });
    const second = await handleGitHubWebhookRequest({
      rawBody: body,
      signatureHeader: signature,
      secret: SECRET,
      deliveryId: fixture.deliveryId,
      event: fixture.event,
      deps,
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body.duplicate, false);
    assert.equal(first.body.eligible, true);
    assert.equal(second.body.duplicate, true);
  });
});
