import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { isBountyError } from "../../bounties/errors";
import { isClaimError } from "../../claims";
import type { ApiKeyScope } from "../../db/schema";
import { logMoneyAction, moneyResultCode } from "../../escrow/actor-log";
import { isEscrowError } from "../../escrow/errors";
import type { FacilitatorSettlementCheck } from "../../escrow/fund-hash";
import { atomicToUsdc, usdcToAtomic } from "../../lib/money";
import {
  buildX402ExactChallenge,
  encodePaymentRequiredHeader,
  x402ResourceUrl,
} from "../../escrow/x402";
import { ZodError } from "zod";
import { PublicApiError, publicApiErrorBody, zodErrorDetails } from "../public/errors";
import {
  DisplayNameError,
  parseDisplayName,
  walletPatchFieldNames,
  type AccountProfile,
  type EmailNotificationPrefs,
  type LinkedAccounts,
} from "../../profile/settings";
import { acceptBountyId } from "../public/query";
import { authorizeClaimCaller } from "./claim-auth";
import {
  claimBodySchema,
  createBountyBodySchema,
  fundBodySchema,
  notificationPatchSchema,
  profilePatchSchema,
  refundBodySchema,
  topUpBodySchema,
} from "./openapi";
import type { AccessDeps, ApiKeyRecord, ClaimKind, PerformedClaim, PublicApiKey } from "./deps";

export type { PublicApiKey };
import {
  apiKeyEnvFor,
  apiKeyHashesEqual,
  apiMoneyEnabled,
  assertCapsAtOrBelow,
  assertKeyMatchesServer,
  assertNoAddress,
  assertNoUserOverride,
  assertSpendWithinCaps,
  decideIdempotency,
  generateApiKey,
  hashApiKey,
  hmacSecret,
  idempotencyExpiresAt,
  keyedRateLimitHeaders,
  KEY_RATE_LIMITS,
  normalizeCapUsdc,
  parseScopes,
  readBearerToken,
  readIdempotencyKey,
  requestHash,
  requireScope,
  spendCeilings,
  statusForDomainCode,
  storedResponseBody,
  utcDayStart,
  type ApiClass,
  type IdempotencyRow,
  type SpendCeilings,
  type StoredApiResponse,
} from "./policy";

export type ApiResult = StoredApiResponse;

const rateHeaderFrame = new AsyncLocalStorage<Record<string, string>>();
const rateHeadersOnError = new WeakMap<PublicApiError, Record<string, string>>();

function publishKeyedRateHeaders(headers: Record<string, string>): void {
  const frame = rateHeaderFrame.getStore();
  if (!frame) return;
  for (const key of Object.keys(frame)) delete frame[key];
  Object.assign(frame, headers);
}

export function rateHeadersFromError(err: unknown): Record<string, string> | undefined {
  return err instanceof PublicApiError ? rateHeadersOnError.get(err) : undefined;
}

/** Copies the RateLimit headers `runAuthed` published while `run` was in flight. */
export async function captureKeyedRateHeaders<T>(run: () => Promise<T>): Promise<{ value: T; headers: Record<string, string> }> {
  const headers: Record<string, string> = {};
  const value = await rateHeaderFrame.run(headers, run);
  return { value, headers };
}

export type ApiPrincipal = {
  keyId: string;
  userId: string;
  name: string;
  env: ApiKeyRecord["env"];
  prefix: string;
  scopes: ReadonlySet<ApiKeyScope>;
  perTxCapUsdc: string;
  dailyCapUsdc: string;
};

export function toPublicKey(row: ApiKeyRecord): PublicApiKey {
  const { keyHash: _hash, ...rest } = row;
  return rest;
}

export async function authenticateBearer(
  authorization: string | null | undefined,
  ip: string,
  deps: AccessDeps,
): Promise<ApiPrincipal | null> {
  const token = readBearerToken(authorization);
  if (!token) return null;
  assertKeyMatchesServer(token, deps.env);
  const secret = hmacSecret(deps.env);
  const keyHash = hashApiKey(token, secret);
  const row = await deps.findKeyByHash(keyHash);
  if (!row || !apiKeyHashesEqual(row.keyHash, keyHash)) {
    throw new PublicApiError("unauthorized", "API key is missing or invalid.");
  }
  if (row.env !== apiKeyEnvFor(deps.env)) {
    throw new PublicApiError("unauthorized", "API key is for a different environment.");
  }
  if (row.revokedAt) {
    throw new PublicApiError("key_revoked", "API key is revoked.", { reason: "revoked" });
  }
  const now = deps.now();
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    throw new PublicApiError("key_revoked", "API key is expired.", { reason: "expired" });
  }
  await deps.touchKey(row.id, now, ip);
  return {
    keyId: row.id,
    userId: row.userId,
    name: row.name,
    env: row.env,
    prefix: row.prefix,
    scopes: new Set(row.scopes),
    perTxCapUsdc: row.perTxCapUsdc,
    dailyCapUsdc: row.dailyCapUsdc,
  };
}

export async function createApiKey(
  input: {
    userId: string;
    name: string;
    scopes: unknown;
    perTxCapUsdc?: string | null;
    dailyCapUsdc?: string | null;
  },
  deps: AccessDeps,
): Promise<{ token: string; key: PublicApiKey }> {
  const name = input.name.trim();
  if (!name || name.length > 80) {
    throw new PublicApiError("validation_failed", "Key name must be 1–80 characters.");
  }
  const scopes = parseScopes(input.scopes);
  if (scopes.includes("money")) {
    const gate = await deps.moneyGate(input.userId);
    if (!gate.wallet) {
      throw new PublicApiError(
        "wallet_not_set",
        "Save a payout wallet before creating a key with the money scope.",
      );
    }
    if (!gate.github) {
      throw new PublicApiError(
        "github_not_linked",
        "Link GitHub before creating a key with the money scope.",
      );
    }
  }
  const ceilings = spendCeilings(deps.env);
  const caps: SpendCeilings = {
    perTxUsdc: input.perTxCapUsdc?.trim()
      ? normalizeCapUsdc(input.perTxCapUsdc, "Per-transaction cap")
      : ceilings.perTxUsdc,
    dailyUsdc: input.dailyCapUsdc?.trim()
      ? normalizeCapUsdc(input.dailyCapUsdc, "Daily cap")
      : ceilings.dailyUsdc,
  };
  assertCapsAtOrBelow(caps, ceilings);
  const generated = generateApiKey(deps.env);
  const now = deps.now();
  const row: ApiKeyRecord = {
    id: randomUUID(),
    userId: input.userId,
    name,
    env: generated.env,
    prefix: generated.prefix,
    keyHash: generated.keyHash,
    scopes,
    perTxCapUsdc: caps.perTxUsdc,
    dailyCapUsdc: caps.dailyUsdc,
    createdAt: now,
    lastUsedAt: null,
    lastUsedIp: null,
    revokedAt: null,
    expiresAt: null,
  };
  await deps.insertKey(row);
  return { token: generated.token, key: toPublicKey(row) };
}

export async function revokeApiKey(userId: string, keyId: string, deps: AccessDeps): Promise<void> {
  const ok = await deps.revokeKey(userId, keyId, deps.now());
  if (!ok) throw new PublicApiError("not_found", "API key not found.");
}

export async function listApiKeys(userId: string, deps: AccessDeps): Promise<PublicApiKey[]> {
  const rows = await deps.listKeys(userId);
  return rows.map(toPublicKey);
}

export async function runAuthed(
  input: {
    principal: ApiPrincipal;
    klass: ApiClass;
    route: string;
    bountyId: string | null;
    ip: string;
  },
  deps: AccessDeps,
  run: () => Promise<ApiResult>,
): Promise<ApiResult> {
  const window = KEY_RATE_LIMITS[input.klass];
  const now = deps.now();
  const logId = await deps.insertRequest({
    keyId: input.principal.keyId,
    userId: input.principal.userId,
    route: `${input.klass} ${input.route}`,
    status: 0,
    bountyId: input.bountyId,
    ip: input.ip,
    createdAt: now,
  });
  const count = await deps.countRequests(
    input.principal.keyId,
    `${input.klass} `,
    new Date(now.getTime() - window.windowMs),
  );
  const rateHeaders = keyedRateLimitHeaders(input.klass, count);
  if (count > window.limit) {
    await deps.updateRequestStatus(logId, 429);
    const retryAfterSeconds = Math.max(1, Math.ceil(window.windowMs / 1000));
    const error = new PublicApiError(
      "rate_limited",
      `Too many ${input.klass} requests for this API key.`,
      { limit: window.limit, windowSeconds: retryAfterSeconds, scope: "per_key", class: input.klass },
      429,
    );
    publishKeyedRateHeaders(rateHeaders);
    rateHeadersOnError.set(error, rateHeaders);
    throw error;
  }
  try {
    const result = await run();
    await deps.updateRequestStatus(logId, result.status);
    publishKeyedRateHeaders(rateHeaders);
    return { ...result, headers: { ...rateHeaders, ...result.headers } };
  } catch (err) {
    const mapped = asApiError(err);
    await deps.updateRequestStatus(logId, mapped.status);
    publishKeyedRateHeaders(rateHeaders);
    rateHeadersOnError.set(mapped, rateHeaders);
    throw mapped;
  }
}

function asApiError(err: unknown): PublicApiError {
  if (err instanceof PublicApiError) return err;
  if (isClaimError(err)) {
    return new PublicApiError(err.code, err.message, null, statusForDomainCode(err.code));
  }
  if (isBountyError(err) || isEscrowError(err)) {
    const details =
      isEscrowError(err) && (err.missing || err.details)
        ? { missing: err.missing ?? null, ...err.details }
        : null;
    return new PublicApiError(err.code, err.message, details, statusForDomainCode(err.code));
  }
  console.error(
    JSON.stringify({
      event: "api_internal",
      message: err instanceof Error ? err.message : "unknown",
    }),
  );
  return new PublicApiError("internal", "Internal error.");
}

export function resultFromError(err: unknown): ApiResult {
  const mapped = asApiError(err);
  return {
    status: mapped.status,
    body: publicApiErrorBody(mapped.code, mapped.message, mapped.details),
  };
}

async function withIdempotency(
  input: {
    principal: ApiPrincipal;
    method: string;
    path: string;
    body: unknown;
    idempotencyKey: string;
    hasPayment: boolean;
  },
  deps: AccessDeps,
  run: () => Promise<ApiResult>,
): Promise<ApiResult> {
  const hash = requestHash(input.method, input.path, input.body);
  const now = deps.now();
  const existing = await deps.findIdempotency(input.principal.keyId, input.idempotencyKey);
  const decision = decideIdempotency(existing, hash, input.hasPayment, now);
  if (decision.type === "conflict") {
    throw new PublicApiError(
      "idempotency_conflict",
      "This Idempotency-Key was already used with a different request body.",
    );
  }
  if (decision.type === "in_progress") {
    throw new PublicApiError(
      "idempotency_conflict",
      "This Idempotency-Key is already in progress.",
    );
  }
  if (decision.type === "replay") return decision.response;

  const placeholder: IdempotencyRow = {
    keyId: input.principal.keyId,
    idempotencyKey: input.idempotencyKey,
    requestHash: hash,
    responseStatus: 0,
    responseBody: {},
    responseHeaders: null,
    expiresAt: existing?.expiresAt ?? idempotencyExpiresAt(now),
  };
  await deps.saveIdempotency(placeholder);
  try {
    const result = await run();
    await deps.saveIdempotency({
      ...placeholder,
      responseStatus: result.status,
      responseBody: storedResponseBody(result.body),
      responseHeaders: result.headers ?? null,
    });
    return result;
  } catch (err) {
    const mapped = asApiError(err);
    const body = publicApiErrorBody(mapped.code, mapped.message, mapped.details);
    await deps.saveIdempotency({
      ...placeholder,
      responseStatus: mapped.status,
      responseBody: storedResponseBody(body),
      responseHeaders: null,
    });
    throw mapped;
  }
}

async function requireMoneyReady(principal: ApiPrincipal, deps: AccessDeps): Promise<void> {
  requireScope(principal.scopes, "money");
  if (!apiMoneyEnabled(deps.env)) {
    throw new PublicApiError(
      "forbidden_scope",
      "Money endpoints are disabled on this network.",
      { apiMoneyEnabled: false, network: deps.env.CDP_NETWORK ?? "base-sepolia" },
    );
  }
  const gate = await deps.moneyGate(principal.userId);
  if (!gate.wallet) {
    throw new PublicApiError("wallet_not_set", "Save a payout wallet before moving USDC with this key.");
  }
  if (!gate.github) {
    throw new PublicApiError("github_not_linked", "Link GitHub before moving USDC with this key.");
  }
}

async function assertCaps(principal: ApiPrincipal, amountUsdc: string, deps: AccessDeps): Promise<void> {
  const spent = await deps.sumOpenSpend(principal.keyId, utcDayStart(deps.now()));
  assertSpendWithinCaps({
    amountUsdc,
    perTxCapUsdc: principal.perTxCapUsdc,
    dailyCapUsdc: principal.dailyCapUsdc,
    spentTodayUsdc: spent,
  });
}

function approvalUrl(origin: string, bountyId: string): string {
  return `${origin.replace(/\/$/, "")}/bounties/${bountyId}`;
}

function paymentRequired(input: {
  bountyId: string;
  amountUsdc: string;
  payTo: string;
  network: string;
  origin: string;
  description: string;
  topUp?: boolean;
}): ApiResult {
  const challenge = buildX402ExactChallenge({
    bountyId: input.bountyId,
    origin: input.origin,
    payTo: input.payTo,
    faceUsdc: input.amountUsdc,
    network: input.network,
    description: input.description,
  });
  const url = approvalUrl(input.origin, input.bountyId);
  return {
    status: 402,
    headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(challenge) },
    body: publicApiErrorBody(
      "payment_required",
      "Payment required. Retry with PAYMENT-SIGNATURE or X-PAYMENT and the same Idempotency-Key.",
      {
        approval_url: url,
        payTo: input.payTo,
        amountUsdc: input.amountUsdc,
        topUp: Boolean(input.topUp),
        paymentRequired: challenge,
      },
    ),
  };
}

export async function handleMe(principal: ApiPrincipal, deps: AccessDeps): Promise<ApiResult> {
  requireScope(principal.scopes, "read");
  const me = await deps.loadMe(principal.userId);
  if (!me) throw new PublicApiError("not_found", "User not found.");
  const money = principal.scopes.has("money");
  return {
    status: 200,
    body: {
      id: me.id,
      displayName: me.displayName,
      email: me.email,
      walletAddress: me.walletAddress,
      githubLogin: me.githubLogin,
      apiKey: {
        id: principal.keyId,
        name: principal.name,
        prefix: principal.prefix,
        env: principal.env,
        scopes: [...principal.scopes],
        perTxCapUsdc: money ? principal.perTxCapUsdc : null,
        dailyCapUsdc: money ? principal.dailyCapUsdc : null,
      },
    },
  };
}

export async function handleUsage(principal: ApiPrincipal, deps: AccessDeps): Promise<ApiResult> {
  requireScope(principal.scopes, "read");
  const since = utcDayStart(deps.now());
  const [spentTodayUsdc, entries] = await Promise.all([
    deps.sumOpenSpend(principal.keyId, since),
    deps.listRecentSpend(principal.keyId, 50),
  ]);
  const remainingAtomic = usdcToAtomic(principal.dailyCapUsdc) - usdcToAtomic(spentTodayUsdc);
  const money = principal.scopes.has("money");
  return {
    status: 200,
    body: {
      perTxCapUsdc: money ? principal.perTxCapUsdc : null,
      dailyCapUsdc: money ? principal.dailyCapUsdc : null,
      spentTodayUsdc: money ? spentTodayUsdc : null,
      remainingTodayUsdc: money ? atomicToUsdc(remainingAtomic > 0n ? remainingAtomic : 0n) : null,
      dayStart: since.toISOString(),
      entries: entries.slice(0, 50).map((row) => ({
        amountUsdc: row.amountUsdc,
        kind: row.kind,
        bountyId: row.bountyId,
        txHash: row.txHash,
        createdAt: row.createdAt.toISOString(),
      })),
    },
  };
}

export async function handleMyBounties(principal: ApiPrincipal, deps: AccessDeps): Promise<ApiResult> {
  requireScope(principal.scopes, "read");
  const mine = await deps.listMyBounties(principal.userId);
  return {
    status: 200,
    body: {
      posted: mine.posted.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        amountUsdc: row.amountUsdc,
        issueUrl: row.issueUrl,
        createdAt: row.createdAt.toISOString(),
        fundedAt: row.fundedAt?.toISOString() ?? null,
      })),
      funded: mine.funded.map((row) => ({
        bountyId: row.bountyId,
        title: row.title,
        status: row.status,
        amountUsdc: row.amountUsdc,
        contributionUsdc: row.contributionUsdc,
        txHash: row.txHash,
        createdAt: row.createdAt.toISOString(),
      })),
    },
  };
}

export async function handleCreateBounty(
  principal: ApiPrincipal,
  body: unknown,
  deps: AccessDeps,
): Promise<ApiResult> {
  requireScope(principal.scopes, "write");
  assertNoAddress(body);
  const parsed = createBountyBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new PublicApiError("validation_failed", "issueUrl and amountUsdc are required.", zodErrorDetails(parsed.error));
  }
  const created = await deps.createBounty({
    posterUserId: principal.userId,
    issueUrl: parsed.data.issueUrl,
    amountUsdc: parsed.data.amountUsdc,
  });
  return {
    status: 201,
    body: {
      id: created.id,
      status: created.status,
      title: created.title,
      amountUsdc: created.amountUsdc,
      issueUrl: created.url,
    },
  };
}

export async function handleWorkSignal(
  principal: ApiPrincipal,
  bountyId: string,
  method: "POST" | "DELETE",
  deps: AccessDeps,
): Promise<ApiResult> {
  requireScope(principal.scopes, "write");
  const id = acceptBountyId(bountyId);
  if (method === "DELETE") {
    const cleared = await deps.clearSignal(id, principal.userId);
    return { status: 200, body: { bountyId, cleared: cleared.cleared } };
  }
  const signal = await deps.signalWorking(id, principal.userId);
  return {
    status: 200,
    body: {
      id: signal.id,
      bountyId: signal.bountyId,
      signaledAt: signal.signaledAt.toISOString(),
    },
  };
}

export async function handleCancel(
  principal: ApiPrincipal,
  bountyId: string,
  idempotencyKey: string,
  deps: AccessDeps,
): Promise<ApiResult> {
  requireScope(principal.scopes, "write");
  const id = acceptBountyId(bountyId);
  const path = `/api/v1/bounties/${id}/cancel`;
  return withIdempotency(
    {
      principal,
      method: "POST",
      path,
      body: {},
      idempotencyKey,
      hasPayment: false,
    },
    deps,
    async () => {
      const bounty = await deps.loadMoneyBounty(id);
      if (!bounty) throw new PublicApiError("not_found", "Bounty not found.");
      if (bounty.posterUserId !== principal.userId) {
        throw new PublicApiError("not_poster", "Only the poster can cancel this bounty.", null, 403);
      }
      if (bounty.status === "cancelled") {
        throw new PublicApiError(
          "already_cancelled",
          "This bounty is already cancelled.",
          { status: bounty.status },
          409,
        );
      }
      if (bounty.status !== "pending_fund") {
        throw new PublicApiError(
          "not_refundable",
          "Only unfunded bounties can be cancelled here. Funded cancel is POST /api/v1/bounties/{id}/refund with a money-scope key.",
          { status: bounty.status },
          409,
        );
      }
      const cancelled = await deps.cancelUnfunded(id, principal.userId, idempotencyKey);
      return {
        status: 200,
        body: {
          id,
          status: cancelled.status,
          refundTxHash: cancelled.refundTxHash,
        },
      };
    },
  );
}

export async function handleFund(
  principal: ApiPrincipal,
  bountyId: string,
  body: unknown,
  idempotencyKey: string,
  paymentSignature: string | null,
  origin: string,
  deps: AccessDeps,
): Promise<ApiResult> {
  await requireMoneyReady(principal, deps);
  assertNoAddress(body);
  const parsedFund = fundBodySchema.safeParse(body ?? {});
  if (!parsedFund.success) {
    throw new PublicApiError(
      "validation_failed",
      "Fund does not take a request body.",
      zodErrorDetails(parsedFund.error),
    );
  }
  const id = acceptBountyId(bountyId);
  const path = `/api/v1/bounties/${id}/fund`;
  return withIdempotency(
    {
      principal,
      method: "POST",
      path,
      body: {},
      idempotencyKey,
      hasPayment: Boolean(paymentSignature),
    },
    deps,
    () =>
      settleAndLock({
        principal,
        bountyId: id,
        paymentSignature,
        origin,
        kind: "fund",
        deps,
        idempotencyKey,
      }),
  );
}

export async function handleTopUp(
  principal: ApiPrincipal,
  bountyId: string,
  body: unknown,
  idempotencyKey: string,
  paymentSignature: string | null,
  origin: string,
  deps: AccessDeps,
): Promise<ApiResult> {
  await requireMoneyReady(principal, deps);
  assertNoAddress(body);
  const parsedTopUp = topUpBodySchema.safeParse(body);
  if (!parsedTopUp.success) {
    throw new PublicApiError("validation_failed", "amountUsdc is required.", zodErrorDetails(parsedTopUp.error));
  }
  const id = acceptBountyId(bountyId);
  const path = `/api/v1/bounties/${id}/top-up`;
  return withIdempotency(
    {
      principal,
      method: "POST",
      path,
      body: { amountUsdc: parsedTopUp.data.amountUsdc },
      idempotencyKey,
      hasPayment: Boolean(paymentSignature),
    },
    deps,
    () =>
      settleAndLock({
        principal,
        bountyId: id,
        paymentSignature,
        origin,
        kind: "top_up",
        amountRaw: parsedTopUp.data.amountUsdc,
        deps,
        idempotencyKey,
      }),
  );
}

async function settleAndLock(input: {
  principal: ApiPrincipal;
  bountyId: string;
  paymentSignature: string | null;
  origin: string;
  kind: "fund" | "top_up";
  amountRaw?: string;
  idempotencyKey: string;
  deps: AccessDeps;
}): Promise<ApiResult> {
  const { principal, bountyId, deps } = input;
  const bounty = await deps.loadMoneyBounty(bountyId);
  if (!bounty) throw new PublicApiError("not_found", "Bounty not found.");

  let amountUsdc = bounty.amountUsdc;
  if (input.kind === "fund") {
    if (bounty.posterUserId !== principal.userId) {
      throw new PublicApiError("not_poster", "Only the poster can fund this bounty.", null, 403);
    }
    if (bounty.status !== "pending_fund") {
      throw new PublicApiError(
        "not_fundable",
        `Bounty is ${bounty.status}, not pending_fund.`,
        { status: bounty.status },
        409,
      );
    }
  } else {
    amountUsdc = normalizeCapUsdc(input.amountRaw ?? "", "Top-up amount");
    await deps.assertTopUpOpen(bountyId);
  }

  await assertCaps(principal, amountUsdc, deps);

  const escrow = await deps.escrowPayTo();
  const description =
    input.kind === "fund"
      ? `GitHub Bounties fund lock: exact face to gb-escrow (${bountyId})`
      : `GitHub Bounties top-up: exact USDC to gb-escrow (bounty ${bountyId})`;
  if (!input.paymentSignature) {
    return paymentRequired({
      bountyId,
      amountUsdc,
      payTo: escrow.payTo,
      network: escrow.network,
      origin: input.origin,
      description,
      topUp: input.kind === "top_up",
    });
  }
  if (escrow.mode !== "cdp") {
    throw new PublicApiError(
      "x402_facilitator_unavailable",
      "Live CDP rail is required to settle x402 exact. The API does not accept a pasted transaction hash.",
      { mode: escrow.mode },
      400,
    );
  }

  const reservedId = await deps.insertSpend({
    keyId: principal.keyId,
    bountyId,
    kind: input.kind,
    amountUsdc,
    txHash: null,
    status: "reserved",
    createdAt: deps.now(),
  });
  try {
    const spent = await deps.sumOpenSpend(principal.keyId, utcDayStart(deps.now()));
    if (usdcToAtomic(spent) > usdcToAtomic(principal.dailyCapUsdc)) {
      throw new PublicApiError(
        "spend_cap_exceeded",
        `This payment would exceed the key's daily cap of ${principal.dailyCapUsdc} USDC.`,
        { amountUsdc, spentTodayUsdc: spent, dailyCapUsdc: principal.dailyCapUsdc },
      );
    }
  } catch (err) {
    await deps.updateSpend(reservedId, { status: "failed" });
    throw err;
  }

  const resourceUrl = x402ResourceUrl(bountyId, input.origin);
  let settled: { txHash: string; payer?: string; facilitatorSettlement?: FacilitatorSettlementCheck };
  try {
    const live = await deps.liveSeller({
      bountyId,
      amountUsdc,
      payTo: escrow.payTo,
      network: escrow.network,
      paymentSignature: input.paymentSignature,
      resourceUrl,
      description,
      actorUserId: principal.userId,
      moneyAction: input.kind === "fund" ? "lock" : "top_up",
    });
    if (live.kind === "challenge" || live.kind === "error") {
      await deps.updateSpend(reservedId, { status: "failed" });
      return sellerFailure(live);
    }
    settled = {
      txHash: live.settled.txHash,
      payer: live.settled.payer,
      facilitatorSettlement: live.settled.facilitatorSettlement,
    };
  } catch (err) {
    await deps.updateSpend(reservedId, { status: "failed" });
    throw err;
  }

  try {
    if (input.kind === "fund") {
      await deps.recordInbound({
        bountyId,
        txHash: settled.txHash,
        payer: settled.payer ?? null,
        payTo: escrow.payTo,
        resourceUrl,
      });
      const locked = await deps.lockFunds({
        bountyId,
        actorUserId: principal.userId,
        fundTxHash: settled.txHash,
        requestId: input.idempotencyKey,
      });
      await deps.updateSpend(reservedId, { status: "recorded", txHash: locked.fundTxHash });
      return {
        status: 200,
        body: {
          id: bountyId,
          status: "funded",
          amountUsdc,
          fundTxHash: locked.fundTxHash,
          payTo: escrow.payTo,
          approval_url: approvalUrl(input.origin, bountyId),
        },
      };
    }
    const applied = await deps.topUp({
      bountyId,
      actorUserId: principal.userId,
      amountUsdc,
      fundTxHash: settled.txHash,
      payer: settled.payer ?? null,
      requestId: input.idempotencyKey,
      facilitatorSettlement: settled.facilitatorSettlement,
    });
    await deps.updateSpend(reservedId, { status: "recorded", txHash: applied.fundTxHash });
    return {
      status: 200,
      body: {
        id: bountyId,
        status: "funded",
        amountUsdc: applied.amountUsdc,
        faceUsdc: applied.faceUsdc,
        fundTxHash: applied.fundTxHash,
        payTo: escrow.payTo,
        approval_url: approvalUrl(input.origin, bountyId),
      },
    };
  } catch (err) {
    await deps.updateSpend(reservedId, { status: "failed", txHash: settled.txHash });
    throw err;
  }
}

function sellerFailure(live: { kind: "challenge" | "error"; challenge?: { body?: unknown; headers?: Record<string, string> }; error?: { status: number; body: unknown } }): ApiResult {
  if (live.kind === "error") {
    const body = live.error?.body;
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const code = typeof record.error === "string" ? record.error : "x402_settle_failed";
    const message = typeof record.message === "string" ? record.message : "x402 settlement failed.";
    return {
      status: live.error?.status || statusForDomainCode(code),
      body: publicApiErrorBody(code, message, body ?? null),
    };
  }
  return {
    status: 400,
    body: publicApiErrorBody(
      "x402_settle_failed",
      "Signed payment was re-challenged. Do not mark funded.",
      live.challenge?.body ?? null,
    ),
  };
}

function auditMoney(
  principal: ApiPrincipal,
  input: {
    action: "winner_claim" | "pool_claim" | "refund";
    bountyId: string;
    leg: "WINNER_PAYOUT" | "POOL_PAYOUT" | "REFUND_OUT";
    result: string;
    requestId: string;
    destination?: string | null;
    amountUsdc?: string | null;
    txHash?: string | null;
    claimId?: string | null;
  },
): void {
  logMoneyAction({
    action: input.action,
    actorUserId: principal.userId,
    bountyId: input.bountyId,
    claimId: input.claimId ?? null,
    destination: input.destination ?? null,
    amountUsdc: input.amountUsdc ?? null,
    txHash: input.txHash ?? null,
    result: input.result,
    requestId: input.requestId,
    apiKeyId: principal.keyId,
    leg: input.leg,
  });
}

function claimLeg(kind: ClaimKind): "WINNER_PAYOUT" | "POOL_PAYOUT" {
  return kind === "pool" ? "POOL_PAYOUT" : "WINNER_PAYOUT";
}

function claimAction(kind: ClaimKind): "winner_claim" | "pool_claim" {
  return kind === "pool" ? "pool_claim" : "winner_claim";
}

export function claimResponseBody(performed: PerformedClaim): Record<string, unknown> {
  return {
    id: performed.bountyId,
    kind: performed.kind,
    status: performed.status,
    bountyStatus: performed.bountyStatus,
    amountUsdc: performed.amountUsdc,
    txHash: performed.txHash,
    destination: performed.destination,
    claimId: performed.claimId,
    participantId: performed.participantId,
  };
}

export async function handleClaim(
  principal: ApiPrincipal,
  bountyId: string,
  body: unknown,
  idempotencyKey: string,
  deps: AccessDeps,
): Promise<ApiResult> {
  let id = bountyId;
  let kind: ClaimKind = "winner";
  let savedWallet: string | null = null;
  try {
    await requireMoneyReady(principal, deps);
    id = acceptBountyId(bountyId);
    assertNoAddress(body);
    assertNoUserOverride(body);
    const parsed = claimBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new PublicApiError(
        "validation_failed",
        "kind must be winner or pool. The body cannot include an address or a user id.",
        zodErrorDetails(parsed.error),
      );
    }
    kind = parsed.data.kind;
    const ctx = await deps.loadClaimAuthz(principal.userId, id, kind);
    savedWallet = ctx.walletAddress;
    authorizeClaimCaller(principal.userId, kind, ctx);
  } catch (err) {
    auditMoney(principal, {
      action: claimAction(kind),
      bountyId: id,
      leg: claimLeg(kind),
      result: moneyResultCode(err),
      requestId: idempotencyKey,
      destination: savedWallet,
    });
    throw err;
  }

  const path = `/api/v1/bounties/${id}/claim`;
  return withIdempotency(
    {
      principal,
      method: "POST",
      path,
      body: { kind },
      idempotencyKey,
      hasPayment: false,
    },
    deps,
    async () => {
      try {
        const performed = await deps.performClaim({
          bountyId: id,
          actorUserId: principal.userId,
          kind,
          requestId: idempotencyKey,
          apiKeyId: principal.keyId,
        });
        auditMoney(principal, {
          action: claimAction(kind),
          bountyId: id,
          leg: claimLeg(kind),
          result: "ok",
          requestId: idempotencyKey,
          destination: performed.destination,
          amountUsdc: performed.amountUsdc,
          txHash: performed.txHash,
          claimId: performed.claimId,
        });
        return { status: 200, body: claimResponseBody(performed) };
      } catch (err) {
        auditMoney(principal, {
          action: claimAction(kind),
          bountyId: id,
          leg: claimLeg(kind),
          result: moneyResultCode(err),
          requestId: idempotencyKey,
          destination: savedWallet,
        });
        throw err;
      }
    },
  );
}

export async function handleRefund(
  principal: ApiPrincipal,
  bountyId: string,
  body: unknown,
  idempotencyKey: string,
  deps: AccessDeps,
): Promise<ApiResult> {
  let id = bountyId;
  let face: string | null = null;
  try {
    await requireMoneyReady(principal, deps);
    id = acceptBountyId(bountyId);
    assertNoAddress(body);
    assertNoUserOverride(body);
    const parsed = refundBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new PublicApiError(
        "validation_failed",
        "Refund does not take an address or a destination.",
        zodErrorDetails(parsed.error),
      );
    }
    const bounty = await deps.loadMoneyBounty(id);
    if (!bounty) throw new PublicApiError("not_found", "Bounty not found.");
    face = bounty.amountUsdc;
    if (bounty.posterUserId !== principal.userId) {
      throw new PublicApiError("not_poster", "Only the poster can refund this bounty.", null, 403);
    }
    if (bounty.status === "pending_fund") {
      throw new PublicApiError(
        "not_refundable",
        "This bounty is not funded. Cancel an unfunded draft with POST /cancel.",
        { status: bounty.status },
        409,
      );
    }
  } catch (err) {
    auditMoney(principal, {
      action: "refund",
      bountyId: id,
      leg: "REFUND_OUT",
      result: moneyResultCode(err),
      requestId: idempotencyKey,
      destination: null,
      amountUsdc: face,
    });
    throw err;
  }

  return withIdempotency(
    {
      principal,
      method: "POST",
      path: `/api/v1/bounties/${id}/refund`,
      body: {},
      idempotencyKey,
      hasPayment: false,
    },
    deps,
    async () => {
      try {
        const refunded = await deps.performRefund({
          bountyId: id,
          actorUserId: principal.userId,
          requestId: idempotencyKey,
          apiKeyId: principal.keyId,
        });
        auditMoney(principal, {
          action: "refund",
          bountyId: id,
          leg: "REFUND_OUT",
          result: "ok",
          requestId: idempotencyKey,
          destination: refunded.destination,
          amountUsdc: refunded.amountUsdc,
          txHash: refunded.refundTxHash,
        });
        return {
          status: 200,
          body: {
            id,
            status: refunded.status,
            refundTxHash: refunded.refundTxHash,
            amountUsdc: refunded.amountUsdc,
            destination: refunded.destination,
          },
        };
      } catch (err) {
        auditMoney(principal, {
          action: "refund",
          bountyId: id,
          leg: "REFUND_OUT",
          result: moneyResultCode(err),
          requestId: idempotencyKey,
          destination: null,
          amountUsdc: face,
        });
        throw err;
      }
    },
  );
}

export async function handleBountyClaims(
  principal: ApiPrincipal,
  bountyId: string,
  deps: AccessDeps,
): Promise<ApiResult> {
  requireScope(principal.scopes, "read");
  const id = acceptBountyId(bountyId);
  const legs = await deps.listClaims(principal.userId, id);
  return { status: 200, body: { bountyId: id, legs } };
}

export async function handleMyClaims(principal: ApiPrincipal, deps: AccessDeps): Promise<ApiResult> {
  requireScope(principal.scopes, "read");
  const claims = await deps.listClaims(principal.userId, null);
  return { status: 200, body: { claims } };
}

const WALLET_CHANGE_MESSAGE =
  "Wallet and payout address changes are only available on the signed-in Settings page.";

function rejectWalletPatch(body: unknown): void {
  const fields = walletPatchFieldNames(body);
  if (fields.length === 0) return;
  throw new PublicApiError("wallet_change_human_only", WALLET_CHANGE_MESSAGE, { fields });
}

function validationFromZod(error: ZodError, fallback: string): PublicApiError {
  const unknown = error.issues.some((issue) => issue.code === "unrecognized_keys");
  return new PublicApiError(
    "validation_failed",
    unknown ? "Unrecognized field." : fallback,
    zodErrorDetails(error),
  );
}

function profileBody(profile: AccountProfile) {
  return {
    id: profile.id,
    displayName: profile.displayName,
    displayNameCustom: profile.displayNameCustom,
    email: profile.email,
  };
}

function notificationBody(prefs: EmailNotificationPrefs) {
  return { email: prefs };
}

export async function handleGetProfile(principal: ApiPrincipal, deps: AccessDeps): Promise<ApiResult> {
  requireScope(principal.scopes, "read");
  const profile = await deps.loadAccountProfile(principal.userId);
  if (!profile) throw new PublicApiError("not_found", "User not found.");
  return { status: 200, body: profileBody(profile) };
}

export async function handleUpdateProfile(
  principal: ApiPrincipal,
  body: unknown,
  deps: AccessDeps,
): Promise<ApiResult> {
  requireScope(principal.scopes, "write");
  rejectWalletPatch(body);
  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) {
    throw validationFromZod(parsed.error, "displayName is required.");
  }
  let displayName: string;
  try {
    displayName = parseDisplayName(parsed.data.displayName);
  } catch (err) {
    if (err instanceof DisplayNameError) {
      throw new PublicApiError("validation_failed", err.message, [{ path: "displayName", message: err.message }]);
    }
    throw err;
  }
  const saved = await deps.saveDisplayName(principal.userId, displayName);
  if (!saved) throw new PublicApiError("not_found", "User not found.");
  return { status: 200, body: profileBody(saved) };
}

export async function handleGetNotificationPreferences(
  principal: ApiPrincipal,
  deps: AccessDeps,
): Promise<ApiResult> {
  requireScope(principal.scopes, "read");
  const profile = await deps.loadAccountProfile(principal.userId);
  if (!profile) throw new PublicApiError("not_found", "User not found.");
  const prefs = await deps.loadEmailNotificationPreferences(principal.userId);
  return { status: 200, body: notificationBody(prefs) };
}

export async function handleUpdateNotificationPreferences(
  principal: ApiPrincipal,
  body: unknown,
  deps: AccessDeps,
): Promise<ApiResult> {
  requireScope(principal.scopes, "write");
  rejectWalletPatch(body);
  const parsed = notificationPatchSchema.safeParse(body);
  if (!parsed.success) {
    const unknown = parsed.error.issues.some((issue) => issue.code === "unrecognized_keys");
    const invalidType = parsed.error.issues.some((issue) => issue.code === "invalid_type");
    const message = unknown
      ? "Unrecognized field."
      : invalidType
        ? "Email preferences must be JSON booleans."
        : "At least one email preference is required.";
    throw new PublicApiError("validation_failed", message, zodErrorDetails(parsed.error));
  }
  const flags = parsed.data.email;
  if (
    flags.bountyFunded === undefined &&
    flags.prMerged === undefined &&
    flags.bountySettled === undefined &&
    flags.poolClaimable === undefined
  ) {
    throw new PublicApiError("validation_failed", "At least one email preference is required.", [
      { path: "email", message: "At least one email preference is required." },
    ]);
  }
  const saved = await deps.saveEmailNotificationPreferences(principal.userId, flags);
  if (!saved) throw new PublicApiError("not_found", "User not found.");
  return { status: 200, body: notificationBody(saved) };
}

export async function handleLinkedAccounts(principal: ApiPrincipal, deps: AccessDeps): Promise<ApiResult> {
  requireScope(principal.scopes, "read");
  const linked = await deps.loadLinkedAccounts(principal.userId);
  if (!linked) throw new PublicApiError("not_found", "User not found.");
  return { status: 200, body: linked satisfies LinkedAccounts };
}

export function requirePrincipal(principal: ApiPrincipal | null | undefined): ApiPrincipal {
  if (!principal) {
    throw new PublicApiError("unauthorized", "Send Authorization: Bearer <api key>. Cookies are not accepted.");
  }
  return principal;
}

export { readIdempotencyKey };
