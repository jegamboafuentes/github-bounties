import { DeliveryStore } from "./delivery-store.js";
import { createWebhookServer } from "./server.js";

const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
if (!secret) {
  console.error(
    "GITHUB_WEBHOOK_SECRET is required. Copy .env.example to .env — do not start without a webhook secret (fail closed).",
  );
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const storePath = process.env.DELIVERY_STORE_PATH ?? ".data/deliveries.json";
const publicBaseUrl =
  process.env.PUBLIC_BASE_URL ?? "https://github-bounties-staging.example.com";

const store = new DeliveryStore(storePath);
const server = createWebhookServer({ secret, store, publicBaseUrl });

server.listen(port, host, () => {
  console.log(
    `GitHub Bounties webhook stub listening on http://${host}:${port}`,
  );
  console.log(`  POST ${publicBaseUrl}/webhooks/github`);
  console.log(`  GET  ${publicBaseUrl}/github/setup`);
  console.log(`  GET  ${publicBaseUrl}/github/callback`);
  console.log(`  delivery store: ${storePath}`);
});
