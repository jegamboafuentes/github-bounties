#!/usr/bin/env node
/**
 * V0-A sandbox/dry-run for the GitHub Bounties money path.
 *
 * Default: credential probe + ledger math (no network, no USDC).
 * Optional live Base Sepolia fund→release: set CDP_* secrets AND
 *   CDP_DRY_RUN_LIVE=1
 * Live mode still refuses mainnet / real USDC prod spend.
 *
 * Exit codes:
 *   0  sandbox math (and optional live path) succeeded
 *   2  blocked — missing credentials or unsafe network (expected in this environment)
 *   1  unexpected failure
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_SECRETS = [
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
  "CDP_WALLET_SECRET",
];

const OPTIONAL_SECRETS = ["CDP_PROJECT_ID", "CDP_CLIENT_API_KEY"];

const MAINNET_NETWORKS = new Set(["base", "eip155:8453", "mainnet"]);

/** USDC has 6 decimals. Fee = face * 0.02, remainder to hunter. */
export function splitFaceAtomic(faceAtomic) {
  if (typeof faceAtomic !== "bigint") {
    throw new TypeError("faceAtomic must be bigint");
  }
  if (faceAtomic <= 0n) {
    throw new RangeError("faceAtomic must be > 0");
  }
  const feeAtomic = (faceAtomic * 2n) / 100n;
  const hunterAtomic = faceAtomic - feeAtomic;
  return { feeAtomic, hunterAtomic };
}

function present(name) {
  const v = process.env[name];
  return Boolean(v && v.trim());
}

function redact(value) {
  if (!value) return "(missing)";
  const t = value.trim();
  if (t.length <= 8) return `${t.slice(0, 2)}…(${t.length} chars)`;
  return `${t.slice(0, 4)}…${t.slice(-4)} (${t.length} chars)`;
}

function probeCredentials() {
  const missing = REQUIRED_SECRETS.filter((n) => !present(n));
  const optionalMissing = OPTIONAL_SECRETS.filter((n) => !present(n));
  const network = (process.env.CDP_NETWORK || "base-sepolia").trim();
  const liveRequested = process.env.CDP_DRY_RUN_LIVE === "1";

  return {
    missing,
    optionalMissing,
    network,
    liveRequested,
    unsafeNetwork: MAINNET_NETWORKS.has(network.toLowerCase()),
  };
}

function printProbe(probe) {
  console.log("GitHub Bounties — V0-A money-path dry-run");
  console.log("Network:", probe.network);
  console.log("Live Base Sepolia requested:", probe.liveRequested ? "yes" : "no");
  console.log("");
  console.log("Secret probe (values redacted):");
  for (const name of REQUIRED_SECRETS) {
    const status = present(name) ? "present" : "MISSING";
    console.log(`  ${name}: ${status} ${present(name) ? redact(process.env[name]) : ""}`);
  }
  for (const name of OPTIONAL_SECRETS) {
    const status = present(name) ? "present" : "absent (optional)";
    console.log(`  ${name}: ${status}`);
  }
  console.log("");
}

function runLedgerFixture() {
  const faceAtomic = 100_000_000n; // 100 USDC
  const { feeAtomic, hunterAtomic } = splitFaceAtomic(faceAtomic);
  console.log("Offline ledger fixture (100.000000 USDC face):");
  console.log("  fee_atomic     =", feeAtomic.toString(), "(2.000000 USDC)");
  console.log("  hunter_atomic  =", hunterAtomic.toString(), "(98.000000 USDC)");
  console.log("  claim-lock     = coordination only; no ledger money row");
  console.log("");

  const rows = [
    {
      kind: "FUND_IN",
      amount_atomic: faceAtomic.toString(),
      status: "confirmed",
      note: "escrow credits face; fee not taken yet",
    },
    {
      kind: "HUNTER_PAYOUT",
      amount_atomic: hunterAtomic.toString(),
      status: "pending",
      note: "settlement leg 1; idempotency key per bounty+kind",
    },
    {
      kind: "FEE_OUT",
      amount_atomic: feeAtomic.toString(),
      status: "pending",
      note: "settlement leg 2; retry independently if partial",
    },
  ];
  console.log("Example ledger rows:");
  console.log(JSON.stringify(rows, null, 2));
  console.log("");
}

async function maybeLive(probe) {
  if (!probe.liveRequested) {
    console.log("Live path skipped (CDP_DRY_RUN_LIVE is not 1).");
    return { attempted: false };
  }
  if (probe.unsafeNetwork) {
    throw Object.assign(new Error("Refusing mainnet / real USDC prod spend"), {
      code: "UNSAFE_NETWORK",
    });
  }
  if (probe.missing.length) {
    return { attempted: false, blocked: true };
  }

  console.log("Live Base Sepolia path: credentials present. Loading @coinbase/cdp-sdk…");
  let CdpClient;
  try {
    ({ CdpClient } = await import("@coinbase/cdp-sdk"));
  } catch {
    console.log("BLOCKED: @coinbase/cdp-sdk is not installed.");
    console.log("Install only in a sandbox workspace: npm install @coinbase/cdp-sdk");
    return { attempted: true, blocked: true, reason: "cdp-sdk-not-installed" };
  }

  const cdp = new CdpClient();
  const escrow = await cdp.evm.getOrCreateAccount({ name: "gb-escrow" });
  const fee = await cdp.evm.getOrCreateAccount({ name: "gb-fee" });
  const hunter = await cdp.evm.getOrCreateAccount({ name: "gb-hunter-dry" });
  console.log("Named wallets (sandbox):");
  console.log("  gb-escrow     ", escrow.address);
  console.log("  gb-fee        ", fee.address);
  console.log("  gb-hunter-dry ", hunter.address);

  const faceAtomic = 1_000_000n; // 1 USDC faucet-sized
  const { feeAtomic, hunterAtomic } = splitFaceAtomic(faceAtomic);

  console.log("Requesting Base Sepolia USDC faucet for escrow (test funds only)…");
  const faucet = await cdp.evm.requestFaucet({
    address: escrow.address,
    network: "base-sepolia",
    token: "usdc",
  });
  console.log("  faucet tx:", faucet.transactionHash);

  const payout = await escrow.transfer({
    to: hunter.address,
    amount: hunterAtomic,
    token: "usdc",
    network: "base-sepolia",
  });
  console.log("  hunter payout tx:", payout.transactionHash);

  const feeTx = await escrow.transfer({
    to: fee.address,
    amount: feeAtomic,
    token: "usdc",
    network: "base-sepolia",
  });
  console.log("  fee tx:", feeTx.transactionHash);
  console.log("Live sandbox fund→release completed (testnet USDC only).");
  return { attempted: true, blocked: false };
}

async function main() {
  const probe = probeCredentials();
  printProbe(probe);
  runLedgerFixture();

  if (probe.unsafeNetwork) {
    console.error("BLOCKED: CDP_NETWORK looks like mainnet. Dry-run refuses real USDC prod spend.");
    process.exit(2);
  }

  if (probe.missing.length) {
    console.error("BLOCKED: sandbox/dry-run cannot call CDP. Missing credentials:");
    for (const name of probe.missing) {
      console.error(`  - GCP Secret Manager / env: ${name}`);
    }
    console.error("");
    console.error("Expected location:");
    console.error("  GCP project github-bounties (133702056111)");
    console.error("  Secret IDs: CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET");
    console.error("  Create in CDP Portal → Secret API Key + Wallet Secret, then store in Secret Manager.");
    console.error("  Docs: https://docs.cdp.coinbase.com/get-started/docs/cdp-api-keys");
    console.error("");
    console.error("No live USDC transfer was attempted.");
    process.exit(2);
  }

  const live = await maybeLive(probe);
  if (live?.blocked) {
    process.exit(2);
  }
  console.log("Dry-run complete. No production user funds were touched.");
}

const isCli = process.argv[1]
  ? path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
  : false;

if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
