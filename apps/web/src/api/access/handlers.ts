import { randomUUID } from "node:crypto";
import { isBountyError } from "../../bounties/errors";
import type { ApiKeyScope } from "../../db/schema";
import { isEscrowError } from "../../escrow/errors";
import { usdcToAtomic } from "../../lib/money";
import {
  buildX402ExactChallenge,
  encodePaymentRequiredHeader,
  x402ResourceUrl,
} from "../../escrow/x402";
import { PublicApiError, publicApiErrorBody, zodErrorDetails } from "../public/errors";
import { acceptBountyId } from "../public/query";
import { createBountyBodySchema, fundBodySchema, topUpBodySchema } from "./openapi";
import type { AccessDeps, ApiKeyRecord, PublicApiKey } from "./deps";

export type { PublicApiKey };
import {
  apiKeyEnvFor,
  apiKeyHashesEqual,
  apiMoneyEnabled,
  assertCapsAtOrBelow,
  assertKeyMatchesServer,
  assertNoAddress,
  assertSpendWithinCaps,
  decideIdempotency,
  generateApiKey,
  hashApiKey,
  hmacSecret,
  idempotencyExpiresAt,
  KEY_RATE_LIMITS,
  normalizeCapUsdc,
  parseScopes,
  readBearerToken,
  readIdempotencyKey,
  requestHash,
  requireScope,
  spendCeilings,
  statusForDomainCode,
  utcDayStart,
  type ApiClass,
  type IdempotencyRow,
  type SpendCeilings,
  type StoredApiResponse,
} from "./policy";

export type ApiResult = StoredApiResponse;

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
  if (count > window.limit) {
    await deps.updateRequestStatus(logId, 429);
    const retryAfterSeconds = Math.max(1, Math.ceil(window.windowMs / 1000));
    throw new PublicApiError(
      "rate_limited",
      `Too many ${input.klass} requests for this API key.`,
      { limit: window.limit, windowSeconds: retryAfterSeconds, scope: "per_key", class: input.klass },
      429,
    );
  }
  try {
    const result = await run();
    await deps.updateRequestStatus(logId, result.status);
    return result;
  } catch (err) {
    const mapped = asApiError(err);
    await deps.updateRequestStatus(logId, mapped.status);
    throw mapped;
  }
}

function asApiError(err: unknown): PublicApiError {
  if (err instanceof PublicApiError) return err;
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
      responseBody: result.body,
      responseHeaders: result.headers ?? null,
    });
    return result;
  } catch (err) {
    const mapped = asApiError(err);
    await deps.saveIdempotency({
      ...placeholder,
      responseStatus: mapped.status,
      responseBody: publicApiErrorBody(mapped.code, mapped.message, mapped.details),
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
        perTxCapUsdc: principal.perTxCapUsdc,
        dailyCapUsdc: principal.dailyCapUsdc,
      },
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
      if (bounty.status !== "pending_fund") {
        throw new PublicApiError(
          "not_refundable",
          "Only unfunded bounties can be cancelled on the API. Funded cancel and refund is not available yet.",
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
  let settled: { txHash: string; payer?: string };
  try {
    const live = await deps.liveSeller({
      bountyId,
      amountUsdc,
      payTo: escrow.payTo,
      network: escrow.network,
      paymentSignature: input.paymentSignature,
      resourceUrl,
      description,
    });
    if (live.kind === "challenge" || live.kind === "error") {
      await deps.updateSpend(reservedId, { status: "failed" });
      return sellerFailure(live);
    }
    settled = { txHash: live.settled.txHash, payer: live.settled.payer };
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

export function requirePrincipal(principal: ApiPrincipal | null | undefined): ApiPrincipal {
  if (!principal) {
    throw new PublicApiError("unauthorized", "Send Authorization: Bearer <api key>. Cookies are not accepted.");
  }
  return principal;
}

export { readIdempotencyKey };
