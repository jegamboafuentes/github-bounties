#!/usr/bin/env tsx
/**
 * Replay a GitHub-shaped delivery against a local (or remote) webhook stub.
 *
 * Signs the body with HMAC-SHA256 unless --header already includes
 * X-Hub-Signature-256.
 *
 * Examples:
 *   GITHUB_WEBHOOK_SECRET='test-secret' npm run replay -- fixtures/pull-request-merged-fixes.json
 *   npm run replay -- fixtures/pull-request-merged-fixes.json --twice
 *
 * `--twice` posts the same X-GitHub-Delivery twice to demonstrate idempotency.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { githubSignature256 } from "../src/verify-signature.js";

type FixtureFile = {
  deliveryId?: string;
  event?: string;
  payload?: unknown;
  body?: string;
};

const args = process.argv.slice(2);
const twice = args.includes("--twice");
const positional = args.filter((a) => !a.startsWith("--"));
const fixturePath = positional[0];
const target =
  positional[1] ??
  process.env.WEBHOOK_URL ??
  "http://127.0.0.1:3000/webhooks/github";

if (!fixturePath) {
  console.error(
    "Usage: tsx scripts/replay-delivery.ts <fixture.json> [url] [--twice]",
  );
  process.exit(1);
}

const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "test-secret";
const fixture = JSON.parse(
  readFileSync(resolve(fixturePath), "utf8"),
) as FixtureFile;

const bodyBuffer = Buffer.from(
  fixture.body ?? JSON.stringify(fixture.payload ?? fixture),
  "utf8",
);
const deliveryId =
  fixture.deliveryId ?? "00000000-0000-4000-8000-000000000001";
const event = fixture.event ?? "pull_request";
const signature = githubSignature256(bodyBuffer, secret);

async function postOnce(label: string): Promise<void> {
  const res = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": signature,
      "user-agent": "GitHub-Hookshot/replay",
    },
    body: bodyBuffer,
  });
  const text = await res.text();
  console.log(`--- ${label} HTTP ${res.status}`);
  console.log(text);
}

await postOnce("first");
if (twice) {
  await postOnce("replay same delivery id");
}
