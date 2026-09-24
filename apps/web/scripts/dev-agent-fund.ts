/**
 * DEV-only walkthrough: a Base Sepolia CDP server wallet posts a bounty and
 * funds it over the public API. Not part of CI.
 *
 *   cd apps/web
 *   GB_API_KEY=gb_test_... \
 *   ISSUE_URL=https://github.com/octo/hello/issues/42 \
 *   AMOUNT_USDC=5 \
 *   npx tsx scripts/dev-agent-fund.ts
 *
 * Needs API_KEY_HMAC_SECRET and the money flag on the DEV service (default on
 * for base-sepolia), plus CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET
 * in this process so the server wallet can sign the x402 challenge.
 * The key must have write and money, and the owner needs a payout wallet and
 * linked GitHub. The request body never includes an address.
 */
import { CdpClient } from "@coinbase/cdp-sdk";
import { buildEip3009Authorization, buildExactPaymentPayload, eip3009TypedData, encodePaymentSignatureHeader } from "../src/wallet/pay-x402";
import type { X402ExactRequirements, X402PaymentRequired } from "../src/escrow/x402";

const base = (process.env.PUBLIC_BASE_URL ?? "https://dev.githubbounties.xyz").replace(/\/$/, "");
const apiKey = process.env.GB_API_KEY?.trim() ?? "";
const issueUrl = process.env.ISSUE_URL?.trim() ?? "";
const amountUsdc = process.env.AMOUNT_USDC?.trim() || "5";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function api(path: string, init: RequestInit = {}): Promise<{ status: number; json: unknown; headers: Headers }> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, json, headers: response.headers };
}

function challengeFrom(json: unknown): X402PaymentRequired {
  const details = (json as { error?: { details?: { paymentRequired?: X402PaymentRequired } } } | null)?.error?.details;
  const payment = details?.paymentRequired;
  if (!payment?.accepts?.[0]) fail(`402 did not include payment requirements: ${JSON.stringify(json)}`);
  return payment;
}

async function main() {
  if (!apiKey.startsWith("gb_test_")) fail("Set GB_API_KEY to a DEV gb_test_ key.");
  if (!issueUrl) fail("Set ISSUE_URL to a public GitHub issue URL.");

  const created = await api("/api/v1/bounties", {
    method: "POST",
    body: JSON.stringify({ issueUrl, amountUsdc }),
  });
  console.log("create", created.status, created.json);
  if (created.status !== 201) fail("Create did not return 201.");
  const bountyId = (created.json as { id?: string }).id;
  if (!bountyId) fail("Create response had no id.");

  const idempotencyKey = `dev-agent-${bountyId}`;
  const unpaid = await api(`/api/v1/bounties/${bountyId}/fund`, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
  });
  console.log("fund 402", unpaid.status, unpaid.json);
  if (unpaid.status !== 402) fail("Expected 402 payment_required before signing.");
  const challenge = challengeFrom(unpaid.json);
  const requirements = challenge.accepts[0] as X402ExactRequirements;

  const cdp = new CdpClient();
  const account = await cdp.evm.getOrCreateAccount({ name: "gb-api-agent" });
  const signer = account as unknown as {
    address: `0x${string}`;
    signTypedData: (args: ReturnType<typeof eip3009TypedData>) => Promise<`0x${string}`>;
  };
  const authorization = buildEip3009Authorization({
    from: signer.address,
    to: requirements.payTo as `0x${string}`,
    amountAtomic: requirements.amount,
    nowSeconds: Math.floor(Date.now() / 1000),
    maxTimeoutSeconds: requirements.maxTimeoutSeconds ?? 300,
  });
  const typed = eip3009TypedData({ requirements, authorization });
  const signature = await signer.signTypedData(typed);
  const payload = buildExactPaymentPayload({ challenge, requirements, authorization, signature });
  const paymentSignature = encodePaymentSignatureHeader(payload);

  const paid = await api(`/api/v1/bounties/${bountyId}/fund`, {
    method: "POST",
    headers: {
      "idempotency-key": idempotencyKey,
      "payment-signature": paymentSignature,
    },
  });
  console.log("fund settled", paid.status, paid.json);
  if (paid.status !== 200) fail("Settle did not return 200.");
  console.log(`Funded ${base}/bounties/${bountyId}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
