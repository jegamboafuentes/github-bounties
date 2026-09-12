import { BASE_SEPOLIA_CAIP2 } from "../lib/constants";
import type { X402ExactRequirements, X402PaymentRequired } from "../escrow/x402";

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type Eip3009Authorization = {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
};

export type X402ExactPaymentPayload = {
  x402Version: 2;
  resource: X402PaymentRequired["resource"];
  accepted: X402ExactRequirements;
  payload: {
    signature: `0x${string}`;
    authorization: Eip3009Authorization;
  };
};

export type WalletTypedDataSigner = {
  address: `0x${string}`;
  signTypedData: (args: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    };
    types: typeof TRANSFER_WITH_AUTHORIZATION_TYPES;
    primaryType: "TransferWithAuthorization";
    message: {
      from: `0x${string}`;
      to: `0x${string}`;
      value: bigint;
      validAfter: bigint;
      validBefore: bigint;
      nonce: `0x${string}`;
    };
  }) => Promise<`0x${string}`>;
};

export type PayX402Result =
  | {
      ok: true;
      inboundRecorded: boolean;
      alreadyFunded?: boolean;
      fundTxHash?: string | null;
      message?: string;
    }
  | { ok: false; error: string; message: string };

function toBase64Json(body: unknown): string {
  const json = JSON.stringify(body);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8").toString("base64");
  }
  return btoa(json);
}

export function encodePaymentSignatureHeader(payload: X402ExactPaymentPayload): string {
  return toBase64Json(payload);
}

export function caip2ToChainId(network: string): number {
  const trimmed = network.trim();
  if (trimmed.startsWith("eip155:")) {
    const id = Number(trimmed.slice("eip155:".length));
    if (Number.isInteger(id) && id > 0) return id;
  }
  if (trimmed === "base-sepolia") return 84532;
  if (trimmed === "base" || trimmed === "base-mainnet") return 8453;
  throw new Error(`Unsupported x402 network: ${network}`);
}

export function randomAuthorizationNonce(randomBytes?: (out: Uint8Array) => void): `0x${string}` {
  const bytes = new Uint8Array(32);
  if (randomBytes) {
    randomBytes(bytes);
  } else if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    throw new Error("No CSPRNG available for the EIP-3009 nonce.");
  }
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function buildEip3009Authorization(input: {
  from: `0x${string}`;
  to: `0x${string}`;
  amountAtomic: string;
  nowSeconds: number;
  maxTimeoutSeconds: number;
  nonce?: `0x${string}`;
}): Eip3009Authorization {
  const timeout = input.maxTimeoutSeconds > 0 ? input.maxTimeoutSeconds : 300;
  const validAfter = Math.max(0, input.nowSeconds - 30);
  const validBefore = input.nowSeconds + timeout;
  return {
    from: input.from,
    to: input.to,
    value: input.amountAtomic,
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce: input.nonce ?? randomAuthorizationNonce(),
  };
}

export function eip3009TypedData(input: {
  requirements: X402ExactRequirements;
  authorization: Eip3009Authorization;
}) {
  const extra = input.requirements.extra ?? { name: "USDC" as const, version: "2" as const };
  const chainId = caip2ToChainId(input.requirements.network);
  return {
    domain: {
      name: extra.name || "USDC",
      version: extra.version || "2",
      chainId,
      verifyingContract: input.requirements.asset as `0x${string}`,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: input.authorization.from,
      to: input.authorization.to,
      value: BigInt(input.authorization.value),
      validAfter: BigInt(input.authorization.validAfter),
      validBefore: BigInt(input.authorization.validBefore),
      nonce: input.authorization.nonce,
    },
  };
}

export function buildExactPaymentPayload(input: {
  challenge: X402PaymentRequired;
  requirements: X402ExactRequirements;
  authorization: Eip3009Authorization;
  signature: `0x${string}`;
}): X402ExactPaymentPayload {
  return {
    x402Version: 2,
    resource: input.challenge.resource,
    accepted: input.requirements,
    payload: {
      signature: input.signature,
      authorization: input.authorization,
    },
  };
}

function asChallenge(body: unknown): X402PaymentRequired | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Partial<X402PaymentRequired>;
  if (!Array.isArray(rec.accepts) || rec.accepts.length === 0) return null;
  if (!rec.resource || typeof rec.resource !== "object") return null;
  return rec as X402PaymentRequired;
}

function payFailure(error: string, message: string): PayX402Result {
  return { ok: false, error, message };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch x402 challenge → EIP-3009 sign → PAYMENT-SIGNATURE retry.
 * Does not Lock; caller POSTs /fund after inboundRecorded.
 */
export async function payX402Exact(input: {
  resourceUrl: string;
  signer: WalletTypedDataSigner;
  fetchImpl?: typeof fetch;
  nowSeconds?: number;
  nonce?: `0x${string}`;
}): Promise<PayX402Result> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const first = await fetchImpl(input.resourceUrl, {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });
  const firstBody = await readJson(first);

  if (first.status === 200) {
    const body = (firstBody ?? {}) as {
      inboundRecorded?: boolean;
      alreadyFunded?: boolean;
      fundTxHash?: string | null;
      message?: string;
    };
    return {
      ok: true,
      inboundRecorded: Boolean(body.inboundRecorded || body.alreadyFunded),
      alreadyFunded: body.alreadyFunded,
      fundTxHash: body.fundTxHash,
      message: body.message,
    };
  }

  if (first.status !== 402) {
    const err = (firstBody ?? {}) as { error?: string; message?: string };
    return payFailure(
      err.error || "x402_challenge_failed",
      err.message || `x402 challenge failed (HTTP ${first.status}).`,
    );
  }

  const challenge = asChallenge(firstBody);
  const requirements = challenge?.accepts[0];
  if (!challenge || !requirements) {
    return payFailure("x402_payment_invalid", "x402 challenge was missing exact requirements.");
  }
  if (requirements.scheme !== "exact") {
    return payFailure("x402_payment_invalid", `Unsupported x402 scheme: ${requirements.scheme}`);
  }
  if (requirements.network === "eip155:8453") {
    return payFailure(
      "mainnet_refused",
      "This UI pays Base Sepolia test USDC only. Mainnet is refused.",
    );
  }

  const authorization = buildEip3009Authorization({
    from: input.signer.address,
    to: requirements.payTo as `0x${string}`,
    amountAtomic: requirements.amount,
    nowSeconds: input.nowSeconds ?? Math.floor(Date.now() / 1000),
    maxTimeoutSeconds: requirements.maxTimeoutSeconds,
    nonce: input.nonce,
  });
  const typed = eip3009TypedData({ requirements, authorization });
  let signature: `0x${string}`;
  try {
    signature = await input.signer.signTypedData(typed);
  } catch (err) {
    return payFailure(
      "wallet_rejected",
      err instanceof Error ? err.message : "Wallet declined the USDC authorization.",
    );
  }

  const payload = buildExactPaymentPayload({
    challenge,
    requirements,
    authorization,
    signature,
  });
  const paid = await fetchImpl(input.resourceUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload),
    },
    credentials: "same-origin",
  });
  const paidBody = (await readJson(paid)) as {
    ok?: boolean;
    inboundRecorded?: boolean;
    alreadyFunded?: boolean;
    fundTxHash?: string | null;
    error?: string;
    message?: string;
  } | null;

  if (paid.status === 200 && (paidBody?.inboundRecorded || paidBody?.alreadyFunded || paidBody?.ok)) {
    return {
      ok: true,
      inboundRecorded: Boolean(paidBody?.inboundRecorded || paidBody?.alreadyFunded),
      alreadyFunded: paidBody?.alreadyFunded,
      fundTxHash: paidBody?.fundTxHash,
      message: paidBody?.message,
    };
  }

  return payFailure(
    paidBody?.error || "x402_settle_failed",
    paidBody?.message || `x402 settle failed (HTTP ${paid.status}).`,
  );
}

export async function lockAfterInbound(
  bountyId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PayX402Result> {
  const res = await fetchImpl(`/api/bounties/${bountyId}/fund`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    credentials: "same-origin",
    body: "{}",
  });
  const body = (await readJson(res)) as {
    ok?: boolean;
    fundTxHash?: string;
    error?: string;
    message?: string;
  } | null;
  if (res.status === 200 && body?.ok) {
    return {
      ok: true,
      inboundRecorded: true,
      alreadyFunded: true,
      fundTxHash: body.fundTxHash,
      message: "Locked in escrow.",
    };
  }
  return payFailure(
    body?.error || "lock_failed",
    body?.message || `Lock failed (HTTP ${res.status}). Paste-hash fallback is still available.`,
  );
}

export const DEFAULT_FUND_CHAIN_CAIP2 = BASE_SEPOLIA_CAIP2;
