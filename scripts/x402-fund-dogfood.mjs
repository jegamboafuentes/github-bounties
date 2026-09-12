#!/usr/bin/env node
/**
 * DEV dogfood probe for x402 exact fund (no secret values printed).
 *
 *   node scripts/x402-fund-dogfood.mjs --url https://dev.githubbounties.xyz/api/bounties/<id>/x402
 *
 * Prints HTTP status, decoded PAYMENT-REQUIRED (scheme/network/amount/payTo),
 * and whether inbound is already recorded. Does not send a payment.
 *
 * To settle: use CdpX402Client + wrapFetchWithPayment against the same URL
 * (Base Sepolia, environment=development). See docs/spikes/x402-exact-fund-lock.md.
 */
const args = process.argv.slice(2);
const urlFlag = args.findIndex((a) => a === "--url");
const url = urlFlag >= 0 ? args[urlFlag + 1] : args.find((a) => a.startsWith("http"));

if (!url) {
  console.error("Usage: node scripts/x402-fund-dogfood.mjs --url <x402 resource URL>");
  process.exit(2);
}

const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
const header = res.headers.get("payment-required") || res.headers.get("PAYMENT-REQUIRED");
let body = null;
try {
  body = await res.json();
} catch {
  body = null;
}

console.log(`GET ${url}`);
console.log(`HTTP ${res.status}`);
if (header) {
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const accept = decoded.accepts?.[0] ?? {};
    console.log("PAYMENT-REQUIRED decoded:");
    console.log(`  scheme=${accept.scheme} network=${accept.network}`);
    console.log(`  amount=${accept.amount} payTo=${accept.payTo}`);
    console.log(`  resource=${decoded.resource?.url ?? body?.resource?.url}`);
  } catch {
    console.log("PAYMENT-REQUIRED header present (could not decode).");
  }
} else {
  console.log("No PAYMENT-REQUIRED header.");
}
if (body?.error) console.log(`body.error=${body.error}`);
if (body?.inboundRecorded) console.log("inbound already recorded — poster can Lock without a hash.");
if (body?.alreadyFunded) console.log("bounty already funded.");
if (res.status === 402) {
  console.log("Next: settle with an x402 exact client, then poster Lock (empty hash).");
}

process.exit(res.status === 200 || res.status === 402 ? 0 : 1);
