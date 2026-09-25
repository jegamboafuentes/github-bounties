import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { atomicToUsdc, usdcToAtomic } from "../../lib/money";
import { PublicApiError } from "../public/errors";
import type { ApiKeyEnv, ApiKeyScope, ApiSpendKind } from "../../db/schema";

export type { ApiKeyEnv, ApiKeyScope, ApiSpendKind };

/** Authenticated read / write / money windows. Anonymous reads stay on the V4-1 IP limiter. */
export const KEY_RATE_LIMITS = {
  read: { limit: 120, windowMs: 60_000 },
  write: { limit: 20, windowMs: 60_000 },
  money: { limit: 10, windowMs: 60 * 60_000 },
} as const;

export type ApiClass = keyof typeof KEY_RATE_LIMITS;

/**
 * RateLimit-Limit, RateLimit-Remaining, and RateLimit-Reset for a keyed call.
 * `count` is how many requests in the window are already logged, including this
 * one. Omit it when the request was rejected before it was counted.
 */
export function keyedRateLimitHeaders(klass: ApiClass, count?: number): Record<string, string> {
  const window = KEY_RATE_LIMITS[klass];
  const remaining = typeof count === "number" ? Math.max(0, window.limit - count) : window.limit;
  return {
    "RateLimit-Limit": String(window.limit),
    "RateLimit-Remaining": String(remaining),
    "RateLimit-Reset": String(Math.ceil(window.windowMs / 1000)),
  };
}

/** DEV defaults. PROD (CDP_NETWORK=base) defaults are lower. Users may only lower these. */
export const DEV_SPEND_CAPS = { perTxUsdc: "50.000000", dailyUsdc: "200.000000" } as const;
export const PROD_SPEND_CAPS = { perTxUsdc: "25.000000", dailyUsdc: "100.000000" } as const;

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAINNET_NETWORKS = new Set(["base", "base-mainnet", "eip155:8453"]);

export type SpendCeilings = { perTxUsdc: string; dailyUsdc: string };

export function networkName(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CDP_NETWORK ?? "base-sepolia").trim().toLowerCase() || "base-sepolia";
}

export function isMainnetNetwork(env: NodeJS.ProcessEnv = process.env): boolean {
  return MAINNET_NETWORKS.has(networkName(env));
}

/** `gb_live_` on mainnet, `gb_test_` on Base Sepolia and every other network. */
export function apiKeyEnvFor(env: NodeJS.ProcessEnv = process.env): ApiKeyEnv {
  return isMainnetNetwork(env) ? "live" : "test";
}

export function apiKeyPrefixFor(env: ApiKeyEnv): "gb_live_" | "gb_test_" {
  return env === "live" ? "gb_live_" : "gb_test_";
}

/**
 * Money endpoints over the public API.
 * Unset: ON for base-sepolia (and the app default network), OFF for mainnet.
 * Explicit `0`/`false`/`off` always disables. Explicit `1`/`true`/`on` enables,
 * including mainnet, so a later sign-off is a deliberate env change.
 */
export function apiMoneyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.API_MONEY_ENABLED?.trim().toLowerCase() ?? "";
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (flag === "1" || flag === "true" || flag === "on") return true;
  return !isMainnetNetwork(env);
}

export function spendCeilings(env: NodeJS.ProcessEnv = process.env): SpendCeilings {
  const defaults = isMainnetNetwork(env) ? PROD_SPEND_CAPS : DEV_SPEND_CAPS;
  return {
    perTxUsdc: capOverride(env.API_PER_TX_CAP_USDC, defaults.perTxUsdc),
    dailyUsdc: capOverride(env.API_DAILY_CAP_USDC, defaults.dailyUsdc),
  };
}

function capOverride(raw: string | undefined, fallback: string): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return fallback;
  return normalizeCapUsdc(trimmed, "API spend cap");
}

export function hmacSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.API_KEY_HMAC_SECRET?.trim() ?? "";
  if (secret.length < 16) {
    throw new PublicApiError(
      "internal",
      "API key verifier is not configured. Set API_KEY_HMAC_SECRET.",
    );
  }
  return secret;
}

/** HMAC-SHA256 hex of the full token. The plaintext is never stored. */
export function hashApiKey(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

export function apiKeyHashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type GeneratedApiKey = {
  token: string;
  prefix: string;
  keyHash: string;
  env: ApiKeyEnv;
};

/** `gb_test_` or `gb_live_` plus 32 random bytes, base64url. Shown once. */
export function generateApiKey(env: NodeJS.ProcessEnv = process.env): GeneratedApiKey {
  const keyEnv = apiKeyEnvFor(env);
  const kind = apiKeyPrefixFor(keyEnv);
  const raw = randomBytes(32).toString("base64url");
  if (Buffer.from(raw, "base64url").length < 32) {
    throw new Error("API key random segment is shorter than 32 bytes.");
  }
  const token = `${kind}${raw}`;
  const prefix = token.slice(0, kind.length + 8);
  return { token, prefix, keyHash: hashApiKey(token, hmacSecret(env)), env: keyEnv };
}

/** Bearer token only. Missing header is anonymous. Anything else is unauthorized. Cookies are ignored. */
export function readBearerToken(authorization: string | null | undefined): string | null {
  if (!authorization?.trim()) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization.trim());
  if (!match?.[1]) {
    throw new PublicApiError(
      "unauthorized",
      "Authorization must be a Bearer API key. Cookies are not accepted.",
    );
  }
  return match[1];
}

export function assertKeyMatchesServer(token: string, env: NodeJS.ProcessEnv = process.env): void {
  const kind = apiKeyPrefixFor(apiKeyEnvFor(env));
  if (!token.startsWith(kind) || token.length < kind.length + 43) {
    throw new PublicApiError("unauthorized", "API key is missing or invalid.");
  }
}

const ADDRESS_KEY = /(address|wallet|payto|payer|destination)/i;
const USER_OVERRIDE_KEY = /^(hunteruserid|hunterid|userid|actoruserid|participantid|claimid|payee)$/i;
const ETH_ADDRESS = /0x[a-fA-F0-9]{40}/;

/** The request body cannot carry an address. Field names and 0x values are both rejected. */
export function assertNoAddress(value: unknown, path = ""): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoAddress(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (ADDRESS_KEY.test(key)) {
        throw new PublicApiError(
          "validation_failed",
          "Request body cannot include an address.",
          { path: path ? `${path}.${key}` : key },
        );
      }
      assertNoAddress(child, path ? `${path}.${key}` : key);
    }
    return;
  }
  if (typeof value === "string" && ETH_ADDRESS.test(value)) {
    throw new PublicApiError(
      "validation_failed",
      "Request body cannot include an address.",
      { path: path || "(body)" },
    );
  }
}

/** The caller is the key owner. A body cannot name another user or claim row. */
export function assertNoUserOverride(value: unknown, path = ""): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUserOverride(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (USER_OVERRIDE_KEY.test(key)) {
      throw new PublicApiError(
        "validation_failed",
        "The caller is the API key owner. Do not send a user id.",
        { path: path ? `${path}.${key}` : key },
      );
    }
    assertNoUserOverride(child, path ? `${path}.${key}` : key);
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method.toUpperCase()} ${path}\n${canonicalJson(body)}`).digest("hex");
}

export function normalizeCapUsdc(raw: string, label: string): string {
  let atomic: bigint;
  try {
    atomic = usdcToAtomic(raw.trim());
  } catch {
    throw new PublicApiError("validation_failed", `${label} must be a USDC amount with up to 6 decimals.`);
  }
  if (atomic <= BigInt(0)) {
    throw new PublicApiError("validation_failed", `${label} must be greater than 0.`);
  }
  return atomicToUsdc(atomic);
}

export function assertCapsAtOrBelow(requested: SpendCeilings, ceilings: SpendCeilings): void {
  if (usdcToAtomic(requested.perTxUsdc) > usdcToAtomic(ceilings.perTxUsdc)) {
    throw new PublicApiError(
      "validation_failed",
      `Per-transaction cap cannot exceed ${ceilings.perTxUsdc} USDC. Ask an admin to raise the ceiling.`,
      { perTxCapUsdc: ceilings.perTxUsdc },
    );
  }
  if (usdcToAtomic(requested.dailyUsdc) > usdcToAtomic(ceilings.dailyUsdc)) {
    throw new PublicApiError(
      "validation_failed",
      `Daily cap cannot exceed ${ceilings.dailyUsdc} USDC. Ask an admin to raise the ceiling.`,
      { dailyCapUsdc: ceilings.dailyUsdc },
    );
  }
  if (usdcToAtomic(requested.dailyUsdc) < usdcToAtomic(requested.perTxUsdc)) {
    throw new PublicApiError(
      "validation_failed",
      "Daily cap must be at least the per-transaction cap.",
    );
  }
}

export function assertSpendWithinCaps(input: {
  amountUsdc: string;
  perTxCapUsdc: string;
  dailyCapUsdc: string;
  spentTodayUsdc: string;
}): void {
  const amount = usdcToAtomic(input.amountUsdc);
  if (amount > usdcToAtomic(input.perTxCapUsdc)) {
    throw new PublicApiError(
      "spend_cap_exceeded",
      `This payment is ${input.amountUsdc} USDC, above the key's per-transaction cap of ${input.perTxCapUsdc} USDC.`,
      { amountUsdc: input.amountUsdc, perTxCapUsdc: input.perTxCapUsdc },
    );
  }
  const next = usdcToAtomic(input.spentTodayUsdc) + amount;
  if (next > usdcToAtomic(input.dailyCapUsdc)) {
    throw new PublicApiError(
      "spend_cap_exceeded",
      `This payment would exceed the key's daily cap of ${input.dailyCapUsdc} USDC.`,
      {
        amountUsdc: input.amountUsdc,
        spentTodayUsdc: input.spentTodayUsdc,
        dailyCapUsdc: input.dailyCapUsdc,
      },
    );
  }
}

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function idempotencyExpiresAt(now: Date): Date {
  return new Date(now.getTime() + IDEMPOTENCY_TTL_MS);
}

export type StoredApiResponse = {
  status: number;
  body: unknown;
  /** Exact JSON bytes stored for replay. jsonb would otherwise reorder object keys. */
  rawBody?: string;
  headers?: Record<string, string> | null;
};

/** Persist the response JSON as a string so a later jsonb read cannot reorder keys. */
export function storedResponseBody(body: unknown): { __raw: string } {
  return { __raw: JSON.stringify(body) };
}

export function unpackStoredBody(stored: unknown): { body: unknown; rawBody?: string } {
  if (stored && typeof stored === "object" && !Array.isArray(stored) && "__raw" in stored) {
    const raw = (stored as { __raw?: unknown }).__raw;
    if (typeof raw === "string") {
      try {
        return { body: JSON.parse(raw) as unknown, rawBody: raw };
      } catch {
        return { body: stored };
      }
    }
  }
  return { body: stored };
}

export type IdempotencyRow = {
  keyId: string;
  idempotencyKey: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  responseHeaders: Record<string, string> | null;
  expiresAt: Date;
};

export type IdempotencyDecision =
  | { type: "proceed" }
  | { type: "replay"; response: StoredApiResponse }
  | { type: "conflict" }
  | { type: "in_progress" };

/**
 * Same key + same body replays a finished response.
 * A stored 402 may continue when the retry carries a payment signature.
 * A different body is `idempotency_conflict`. Status 0 is in progress.
 */
export function decideIdempotency(
  existing: IdempotencyRow | null,
  requestHashValue: string,
  hasPayment: boolean,
  now: Date,
): IdempotencyDecision {
  if (!existing || existing.expiresAt.getTime() <= now.getTime()) return { type: "proceed" };
  if (existing.requestHash !== requestHashValue) return { type: "conflict" };
  if (existing.responseStatus === 0) return { type: "in_progress" };
  if (existing.responseStatus === 402 && hasPayment) return { type: "proceed" };
  const unpacked = unpackStoredBody(existing.responseBody);
  return {
    type: "replay",
    response: {
      status: existing.responseStatus,
      body: unpacked.body,
      rawBody: unpacked.rawBody,
      headers: existing.responseHeaders,
    },
  };
}

export function parseScopes(raw: unknown): ApiKeyScope[] {
  const values = Array.isArray(raw) ? raw : [];
  const allowed = new Set<ApiKeyScope>(["read", "write", "money"]);
  const scopes: ApiKeyScope[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !allowed.has(value as ApiKeyScope)) {
      throw new PublicApiError("validation_failed", "Scopes must be read, write, or money.");
    }
    const scope = value as ApiKeyScope;
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  if (scopes.length === 0) {
    throw new PublicApiError("validation_failed", "Choose at least one scope.");
  }
  return scopes;
}

export function requireScope(scopes: ReadonlySet<string>, scope: ApiKeyScope): void {
  if (!scopes.has(scope)) {
    throw new PublicApiError(
      "forbidden_scope",
      `This API key is missing the ${scope} scope.`,
      { required: scope },
    );
  }
}

export function readIdempotencyKey(value: string | null | undefined, required: boolean): string | null {
  const key = value?.trim() ?? "";
  if (!key) {
    if (!required) return null;
    throw new PublicApiError(
      "idempotency_key_required",
      "Idempotency-Key is required on fund, top-up, cancel, claim, and refund.",
    );
  }
  if (key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new PublicApiError(
      "validation_failed",
      "Idempotency-Key must be 1–200 characters of letters, numbers, and . _ : -.",
    );
  }
  return key;
}

const DOMAIN_STATUS: Record<string, number> = {
  unauthorized: 401,
  bounty_not_found: 404,
  issue_not_found: 404,
  not_found: 404,
  not_poster: 403,
  not_winner: 403,
  not_hunter: 403,
  not_pool_member: 403,
  not_settler: 403,
  not_eligible: 403,
  hunter_not_linked: 403,
  forbidden_scope: 403,
  bounty_exists: 409,
  not_fundable: 409,
  not_refundable: 409,
  not_settleable: 409,
  pool_not_ready: 409,
  already_cancelled: 409,
  not_claimable: 409,
  conflict: 409,
  invalid_issue_url: 400,
  invalid_amount: 400,
  issue_closed: 400,
  not_an_issue: 400,
  issue_inaccessible: 400,
  issue_rate_limited: 429,
  github_unavailable: 503,
  fund_hash_reused: 409,
  x402_settle_failed: 402,
  x402_facilitator_unavailable: 503,
  mainnet_refused: 400,
};

export function statusForDomainCode(code: string): number {
  return DOMAIN_STATUS[code] ?? 400;
}
