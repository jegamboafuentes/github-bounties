import {
  BASE_MAINNET_CAIP2,
  BASE_SEPOLIA_CAIP2,
  CDP_DEFAULT_NETWORK,
  PRODUCT_NAME,
  USDC_BASE_MAINNET,
  USDC_BASE_SEPOLIA,
  USDC_EIP712_NAME_MAINNET,
  USDC_EIP712_NAME_SEPOLIA,
  USDC_EIP712_VERSION,
} from "../lib/constants";
import { usdcToAtomic } from "../lib/money";
import type { EnvMap } from "./env";

export const X402_VERSION = 2;
export const X402_EXACT_SCHEME = "exact";
export const X402_RESOURCE_PATH = (bountyId: string) => `/api/bounties/${bountyId}/x402`;

export const X402_PAYMENT_SIGNATURE_HEADERS = [
  "payment-signature",
  "PAYMENT-SIGNATURE",
  "x-payment",
  "X-PAYMENT",
] as const;

export type X402NetworkCaip2 = typeof BASE_SEPOLIA_CAIP2 | typeof BASE_MAINNET_CAIP2;

export type X402ResourceInfo = {
  url: string;
  description: string;
  mimeType: "application/json";
};

export type X402ExactRequirements = {
  scheme: typeof X402_EXACT_SCHEME;
  network: X402NetworkCaip2;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: typeof USDC_EIP712_NAME_SEPOLIA | typeof USDC_EIP712_NAME_MAINNET; version: typeof USDC_EIP712_VERSION };
};

/** x402 v2 PaymentRequired — same shape CdpX402Client / @x402/core expect. */
export type X402PaymentRequired = {
  x402Version: typeof X402_VERSION;
  error: string;
  resource: X402ResourceInfo;
  accepts: X402ExactRequirements[];
};

export function publicOrigin(env: EnvMap = process.env, requestOrigin?: string): string {
  const configured = env.PUBLIC_BASE_URL?.trim() || env.AUTH_URL?.trim() || "";
  const raw = configured || requestOrigin?.trim() || "";
  return raw.replace(/\/$/, "");
}

export function x402ResourceUrl(bountyId: string, origin: string): string {
  const base = origin.replace(/\/$/, "");
  const path = X402_RESOURCE_PATH(bountyId);
  return base ? `${base}${path}` : path;
}

export function x402NetworkCaip2(network: string): X402NetworkCaip2 {
  const n = network.trim().toLowerCase();
  if (n === "base" || n === "base-mainnet" || n === BASE_MAINNET_CAIP2 || n === "eip155:8453") {
    return BASE_MAINNET_CAIP2;
  }
  return BASE_SEPOLIA_CAIP2;
}

export function x402UsdcAsset(network: string): string {
  return x402NetworkCaip2(network) === BASE_MAINNET_CAIP2 ? USDC_BASE_MAINNET : USDC_BASE_SEPOLIA;
}

/** EIP-712 domain for the USDC asset on this fund chain. */
export function x402UsdcEip712Extra(network: string): X402ExactRequirements["extra"] {
  const mainnet = x402NetworkCaip2(network) === BASE_MAINNET_CAIP2;
  return {
    name: mainnet ? USDC_EIP712_NAME_MAINNET : USDC_EIP712_NAME_SEPOLIA,
    version: USDC_EIP712_VERSION,
  };
}

/** Dollar price for x402 route config (`$12.00`). Preserves >2 dp when face is not cents. */
export function x402DollarPrice(faceUsdc: string): string {
  const atomic = usdcToAtomic(faceUsdc);
  if (atomic % 10_000n === 0n) {
    const cents = atomic / 10_000n;
    const whole = cents / 100n;
    const frac = (cents % 100n).toString().padStart(2, "0");
    return `$${whole}.${frac}`;
  }
  const trimmed = faceUsdc.trim().replace(/\.?0+$/, "") || "0";
  return `$${trimmed}`;
}

export function buildX402ExactChallenge(input: {
  bountyId: string;
  origin: string;
  payTo: string;
  faceUsdc: string;
  network: string;
  maxTimeoutSeconds?: number;
}): X402PaymentRequired {
  const amount = usdcToAtomic(input.faceUsdc).toString();
  const url = x402ResourceUrl(input.bountyId, input.origin);
  const network = x402NetworkCaip2(input.network);
  return {
    x402Version: X402_VERSION,
    error: "Payment required",
    resource: {
      url,
      description: `${PRODUCT_NAME} fund lock: exact face USDC to gb-escrow (bounty ${input.bountyId})`,
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: X402_EXACT_SCHEME,
        network,
        asset: x402UsdcAsset(input.network),
        amount,
        payTo: input.payTo,
        maxTimeoutSeconds: input.maxTimeoutSeconds ?? 300,
        extra: x402UsdcEip712Extra(input.network),
      },
    ],
  };
}

export function encodePaymentRequiredHeader(body: X402PaymentRequired): string {
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64");
}

/**
 * 402 JSON extras (payTo, rail, …) must not clobber spec fields.
 * DEV #31 remount: `resource: resourceUrl` overwrote the resource object with a
 * string, so the WalletConnect client rejected the challenge as
 * "missing exact requirements" even though PAYMENT-REQUIRED + accepts were exact.
 */
export function x402ChallengeResponseBody(
  challenge: X402PaymentRequired,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  const safe = { ...extras };
  if (typeof safe.resource === "string") {
    safe.resourceUrl = safe.resource;
    delete safe.resource;
  }
  delete safe.accepts;
  delete safe.x402Version;
  return {
    ...challenge,
    ...safe,
    resource: challenge.resource,
    accepts: challenge.accepts,
    x402Version: challenge.x402Version,
  };
}

export function decodePaymentRequiredHeader(header: string): X402PaymentRequired {
  const json = Buffer.from(header.trim(), "base64").toString("utf8");
  return JSON.parse(json) as X402PaymentRequired;
}

export function extractPaymentHeader(
  getHeader: (name: string) => string | null | undefined,
): string | undefined {
  for (const name of X402_PAYMENT_SIGNATURE_HEADERS) {
    const value = getHeader(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function headerLookup(headers: Record<string, string>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * @x402/core v2 puts verify failures in PAYMENT-REQUIRED.error and often
 * returns an empty JSON body. Decode that header (no secrets) for logs/UI.
 */
export function x402FailureFromChallenge(input: {
  body?: unknown;
  headers?: Record<string, string>;
  errorReason?: string;
  errorMessage?: string;
}): { errorReason: string; errorMessage: string } {
  const fromArgs = input.errorReason?.trim() || input.errorMessage?.trim() || "";
  const body = input.body && typeof input.body === "object" ? (input.body as Record<string, unknown>) : null;
  const fromBody =
    (typeof body?.errorReason === "string" && body.errorReason.trim()) ||
    (typeof body?.errorMessage === "string" && body.errorMessage.trim()) ||
    (typeof body?.error === "string" &&
    body.error !== "payment_required" &&
    body.error !== "Payment required"
      ? body.error.trim()
      : "") ||
    "";
  const encoded =
    (input.headers &&
      (headerLookup(input.headers, "PAYMENT-REQUIRED") || headerLookup(input.headers, "payment-required"))) ||
    "";
  let fromHeader = "";
  if (encoded) {
    try {
      const decoded = decodePaymentRequiredHeader(encoded);
      const err = decoded.error?.trim();
      if (err && err !== "Payment required" && err !== "payment_required") fromHeader = err;
    } catch {
      /* ignore malformed header */
    }
  }
  const errorReason = fromArgs || fromBody || fromHeader || "x402_verify_failed";
  const errorMessage =
    (typeof body?.message === "string" && body.message.trim()) ||
    input.errorMessage?.trim() ||
    fromHeader ||
    errorReason;
  return { errorReason, errorMessage };
}

/** Cloud Run stdout — no payloads, signatures, or secrets. */
export function logX402PaidFailure(event: string, details: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      event,
      ...details,
    }),
  );
}

export function x402ExactStatus(env: EnvMap = process.env) {
  const origin = publicOrigin(env);
  return {
    scheme: X402_EXACT_SCHEME,
    version: X402_VERSION,
    payToAccount: "gb-escrow",
    resource: "/api/bounties/:id/x402",
    origin: origin || null,
    hostedCheckout: "disabled" as const,
    defaultNetwork: env.CDP_NETWORK?.trim() || CDP_DEFAULT_NETWORK,
  };
}
