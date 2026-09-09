import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DeliveryStore } from "../src/delivery-store.js";
import { createRequestListener } from "../src/server.js";
import type { GitHubWebhookPayload } from "../src/types.js";
import { githubSignature256 } from "../src/verify-signature.js";

const fixture = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../fixtures/pull-request-merged-fixes.json",
    ),
    "utf8",
  ),
) as {
  deliveryId: string;
  event: string;
  payload: GitHubWebhookPayload;
};

const SECRET = "test-webhook-secret";

async function withServer(
  fn: (base: string, logs: string[], store: DeliveryStore) => Promise<void>,
): Promise<void> {
  const logs: string[] = [];
  const store = new DeliveryStore();
  const server = createServer(
    createRequestListener({
      secret: SECRET,
      store,
      log: (line) => logs.push(line),
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected tcp address");
  }
  try {
    await fn(`http://127.0.0.1:${addr.port}`, logs, store);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

describe("webhook HTTP stub", () => {
  it("rejects an unsigned body", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/webhooks/github`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "ping",
          "x-github-delivery": "unsigned",
        },
        body: "{}",
      });
      assert.equal(res.status, 401);
    });
  });

  it("accepts GitHub's official signed payload bytes (non-JSON body → 400 after verify)", async () => {
    const vector = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../fixtures/github-official-signature.json",
        ),
        "utf8",
      ),
    ) as { secret: string; payload: string; signature256: string };

    const logs: string[] = [];
    const server = createServer(
      createRequestListener({
        secret: vector.secret,
        store: new DeliveryStore(),
        log: (line) => logs.push(line),
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("expected tcp");
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/webhooks/github`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "ping",
          "x-github-delivery": "official-vector",
          "x-hub-signature-256": vector.signature256,
        },
        body: vector.payload,
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, "invalid json");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("is idempotent on replay of the same X-GitHub-Delivery", async () => {
    await withServer(async (base, logs) => {
      const body = Buffer.from(JSON.stringify(fixture.payload), "utf8");
      const headers = {
        "content-type": "application/json",
        "x-github-event": fixture.event,
        "x-github-delivery": fixture.deliveryId,
        "x-hub-signature-256": githubSignature256(body, SECRET),
      };

      const first = await fetch(`${base}/webhooks/github`, {
        method: "POST",
        headers,
        body,
      });
      const second = await fetch(`${base}/webhooks/github`, {
        method: "POST",
        headers,
        body,
      });

      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      const firstJson = (await first.json()) as {
        duplicate: boolean;
        eligible: boolean;
      };
      const secondJson = (await second.json()) as {
        duplicate: boolean;
        eligible: boolean;
      };
      assert.equal(firstJson.duplicate, false);
      assert.equal(firstJson.eligible, true);
      assert.equal(secondJson.duplicate, true);
      assert.equal(
        logs.filter((line) => line.includes("would mark claim eligible")).length,
        1,
      );
    });
  });

  it("returns 200 on /healthz", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/healthz`);
      assert.equal(res.status, 200);
    });
  });
});
