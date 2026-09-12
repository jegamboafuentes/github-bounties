import {
  BASE_MAINNET_CAIP2,
  BASE_SEPOLIA_CAIP2,
  CDP_DEFAULT_NETWORK,
  PRODUCT_NAME,
  USDC_BASE_MAINNET,
  USDC_BASE_SEPOLIA,
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
  extra: { name: "USDC"; version: "2" };
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
        extra: { name: "USDC", version: "2" },
      },
    ],
  };
}

export function encodePaymentRequiredHeader(body: X402PaymentRequired): string {
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64");
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
