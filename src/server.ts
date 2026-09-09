import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { handleDelivery } from "./handler.js";
import type { DeliveryStore } from "./delivery-store.js";
import type { GitHubWebhookPayload } from "./types.js";
import { verifyGitHubSignature } from "./verify-signature.js";

export type WebhookServerOptions = {
  secret: string;
  store: DeliveryStore;
  log?: (line: string) => void;
  publicBaseUrl?: string;
};

export function createRequestListener(opts: WebhookServerOptions) {
  return async function listener(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      await route(req, res, opts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      (opts.log ?? console.error)(`[server] unhandled ${message}`);
      if (!res.headersSent) {
        json(res, 500, { error: "internal" });
      }
    }
  };
}

export function createWebhookServer(opts: WebhookServerOptions): Server {
  return createServer(createRequestListener(opts));
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  opts: WebhookServerOptions,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/healthz") {
    json(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/github/setup") {
    const installationId = url.searchParams.get("installation_id");
    (opts.log ?? console.log)(
      `[setup] GitHub App install redirect installation_id=${installationId ?? "(missing)"} — do not trust this query param without a later user token check`,
    );
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(
      "GitHub Bounties: app installed. Product users will sign in with Google later; this GitHub App is repo authority only.\n",
    );
    return;
  }

  if (method === "GET" && url.pathname === "/github/callback") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(
      "GitHub App user-authorization callback (unused in V0-B). Product auth is Google Sign-In later.\n",
    );
    return;
  }

  if (method === "POST" && url.pathname === "/webhooks/github") {
    await handleWebhook(req, res, opts);
    return;
  }

  json(res, 404, { error: "not found" });
}

async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  opts: WebhookServerOptions,
): Promise<void> {
  const rawBody = await readBody(req);
  const signature = header(req, "x-hub-signature-256");

  if (!verifyGitHubSignature(rawBody, signature, opts.secret)) {
    json(res, 401, { error: "invalid signature" });
    return;
  }

  const deliveryId = header(req, "x-github-delivery");
  const event = header(req, "x-github-event");
  if (!deliveryId || !event) {
    json(res, 400, { error: "missing X-GitHub-Delivery or X-GitHub-Event" });
    return;
  }

  let payload: GitHubWebhookPayload = {};
  if (rawBody.length > 0) {
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as GitHubWebhookPayload;
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
  }

  const result = handleDelivery({
    deliveryId,
    event,
    payload,
    deps: { store: opts.store, log: opts.log },
  });

  json(res, 200, {
    ok: true,
    duplicate: result.duplicate,
    deliveryId: result.deliveryId,
    event: result.event,
    eligible: result.decision?.eligible ?? false,
    closedIssueNumbers: result.decision?.closedIssueNumbers ?? [],
  });
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
  });
  res.end(payload);
}
