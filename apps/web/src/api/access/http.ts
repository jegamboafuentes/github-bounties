import { clientIpFromRequest } from "../public/client-ip";
import { PUBLIC_API_CORS_HEADERS } from "../public/cors";
import { PublicApiError } from "../public/errors";
import { acceptBountyId } from "../public/query";
import { handlePublicRead } from "../public/http";
import { getRuntimeDb } from "../../db/runtime";
import { publicOrigin } from "../../escrow/x402";
import { extractPaymentHeader } from "../../escrow/x402";
import { createAccessDeps } from "./store";
import type { AccessDeps } from "./deps";
import {
  authenticateBearer,
  handleBountyClaims,
  handleCancel,
  handleClaim,
  handleCreateBounty,
  handleFund,
  handleGetNotificationPreferences,
  handleGetProfile,
  handleLinkedAccounts,
  handleMe,
  handleMyClaims,
  handleMyBounties,
  handleRefund,
  handleUpdateNotificationPreferences,
  handleUpdateProfile,
  handleUsage,
  handleTopUp,
  handleWorkSignal,
  readIdempotencyKey,
  requirePrincipal,
  rateHeadersFromError,
  resultFromError,
  runAuthed,
  type ApiPrincipal,
  type ApiResult,
} from "./handlers";
import { keyedRateLimitHeaders, type ApiClass } from "./policy";

export function runtimeAccessDeps(): AccessDeps {
  return createAccessDeps(getRuntimeDb());
}

export type V1Action =
  | { kind: "me" }
  | { kind: "usage" }
  | { kind: "my-bounties" }
  | { kind: "create" }
  | { kind: "signal"; bountyId: string; method: "POST" | "DELETE" }
  | { kind: "cancel"; bountyId: string }
  | { kind: "fund"; bountyId: string }
  | { kind: "top-up"; bountyId: string }
  | { kind: "claim"; bountyId: string }
  | { kind: "refund"; bountyId: string }
  | { kind: "bounty-claims"; bountyId: string }
  | { kind: "my-claims" }
  | { kind: "profile" }
  | { kind: "profile-patch" }
  | { kind: "notification-preferences" }
  | { kind: "notification-preferences-patch" }
  | { kind: "linked-accounts" };

function actionClass(action: V1Action): ApiClass {
  if (action.kind === "fund" || action.kind === "top-up" || action.kind === "claim" || action.kind === "refund") {
    return "money";
  }
  if (
    action.kind === "me" ||
    action.kind === "usage" ||
    action.kind === "my-bounties" ||
    action.kind === "my-claims" ||
    action.kind === "bounty-claims" ||
    action.kind === "profile" ||
    action.kind === "notification-preferences" ||
    action.kind === "linked-accounts"
  ) {
    return "read";
  }
  return "write";
}

export { keyedRateLimitHeaders };

function actionRoute(action: V1Action): string {
  switch (action.kind) {
    case "me":
      return "GET /api/v1/me";
    case "usage":
      return "GET /api/v1/me/usage";
    case "my-bounties":
      return "GET /api/v1/me/bounties";
    case "create":
      return "POST /api/v1/bounties";
    case "signal":
      return `${action.method} /api/v1/bounties/${action.bountyId}/work-signal`;
    case "cancel":
      return `POST /api/v1/bounties/${action.bountyId}/cancel`;
    case "fund":
      return `POST /api/v1/bounties/${action.bountyId}/fund`;
    case "top-up":
      return `POST /api/v1/bounties/${action.bountyId}/top-up`;
    case "claim":
      return `POST /api/v1/bounties/${action.bountyId}/claim`;
    case "refund":
      return `POST /api/v1/bounties/${action.bountyId}/refund`;
    case "bounty-claims":
      return `GET /api/v1/bounties/${action.bountyId}/claims`;
    case "my-claims":
      return "GET /api/v1/me/claims";
    case "profile":
      return "GET /api/v1/me/profile";
    case "profile-patch":
      return "PATCH /api/v1/me/profile";
    case "notification-preferences":
      return "GET /api/v1/me/notification-preferences";
    case "notification-preferences-patch":
      return "PATCH /api/v1/me/notification-preferences";
    case "linked-accounts":
      return "GET /api/v1/me/linked-accounts";
  }
}

function actionBountyId(action: V1Action): string | null {
  if (
    action.kind === "signal" ||
    action.kind === "cancel" ||
    action.kind === "fund" ||
    action.kind === "top-up" ||
    action.kind === "claim" ||
    action.kind === "refund" ||
    action.kind === "bounty-claims"
  ) {
    return action.bountyId;
  }
  return null;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PublicApiError("validation_failed", "Request body must be JSON.");
  }
}

export function apiResultResponse(result: ApiResult): Response {
  const headers = new Headers({ "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
  for (const [key, value] of Object.entries(PUBLIC_API_CORS_HEADERS)) headers.set(key, value);
  for (const [key, value] of Object.entries(result.headers ?? {})) headers.set(key, value);
  if (result.status === 401) headers.set("WWW-Authenticate", "Bearer");
  const retryAfter =
    result.status === 429 &&
    result.body &&
    typeof result.body === "object" &&
    "error" in result.body &&
    (result.body as { error?: { details?: { windowSeconds?: number } } }).error?.details?.windowSeconds;
  if (typeof retryAfter === "number") headers.set("Retry-After", String(retryAfter));
  const payload = typeof result.rawBody === "string" ? result.rawBody : JSON.stringify(result.body);
  return new Response(payload, { status: result.status, headers });
}

export async function handleV1Action(
  request: Request,
  action: V1Action,
  deps: AccessDeps = runtimeAccessDeps(),
): Promise<Response> {
  const ip = clientIpFromRequest(request);
  const klass = actionClass(action);
  const rateHeaders = keyedRateLimitHeaders(klass);
  try {
    const principal = requirePrincipal(
      await authenticateBearer(request.headers.get("authorization"), ip, deps),
    );
    const bountyId = actionBountyId(action);
    if (bountyId) acceptBountyId(bountyId);
    const result = await runAuthed(
      { principal, klass, route: actionRoute(action), bountyId: actionBountyId(action), ip },
      deps,
      () => perform(request, action, principal, deps),
    );
    return apiResultResponse({
      ...result,
      headers: {
        ...rateHeaders,
        ...result.headers,
      },
    });
  } catch (err) {
    const result = resultFromError(err);
    return apiResultResponse({
      ...result,
      headers: { ...rateHeaders, ...rateHeadersFromError(err), ...result.headers },
    });
  }
}

async function perform(
  request: Request,
  action: V1Action,
  principal: ApiPrincipal,
  deps: AccessDeps,
): Promise<ApiResult> {
  const origin = publicOrigin(deps.env, new URL(request.url).origin);
  const idempotency = request.headers.get("idempotency-key");
  const payment = extractPaymentHeader((name) => request.headers.get(name)) ?? null;
  switch (action.kind) {
    case "me":
      return handleMe(principal, deps);
    case "usage":
      return handleUsage(principal, deps);
    case "my-bounties":
      return handleMyBounties(principal, deps);
    case "create":
      return handleCreateBounty(principal, await readJsonBody(request), deps);
    case "signal":
      return handleWorkSignal(principal, action.bountyId, action.method, deps);
    case "cancel":
      return handleCancel(principal, action.bountyId, readIdempotencyKey(idempotency, true) as string, deps);
    case "fund":
      return handleFund(
        principal,
        action.bountyId,
        await readJsonBody(request),
        readIdempotencyKey(idempotency, true) as string,
        payment,
        origin,
        deps,
      );
    case "top-up":
      return handleTopUp(
        principal,
        action.bountyId,
        await readJsonBody(request),
        readIdempotencyKey(idempotency, true) as string,
        payment,
        origin,
        deps,
      );
    case "claim":
      return handleClaim(
        principal,
        action.bountyId,
        await readJsonBody(request),
        readIdempotencyKey(idempotency, true) as string,
        deps,
      );
    case "refund":
      return handleRefund(
        principal,
        action.bountyId,
        await readJsonBody(request),
        readIdempotencyKey(idempotency, true) as string,
        deps,
      );
    case "bounty-claims":
      return handleBountyClaims(principal, action.bountyId, deps);
    case "my-claims":
      return handleMyClaims(principal, deps);
    case "profile":
      return handleGetProfile(principal, deps);
    case "profile-patch":
      return handleUpdateProfile(principal, await readJsonBody(request), deps);
    case "notification-preferences":
      return handleGetNotificationPreferences(principal, deps);
    case "notification-preferences-patch":
      return handleUpdateNotificationPreferences(principal, await readJsonBody(request), deps);
    case "linked-accounts":
      return handleLinkedAccounts(principal, deps);
  }
}

/** Anonymous reads keep the V4-1 IP limiter. A Bearer key uses the per-key read limit. */
export async function handleV1Get(
  request: Request,
  run: () => Promise<Response>,
  deps?: AccessDeps,
): Promise<Response> {
  if (!request.headers.get("authorization")?.trim()) {
    return handlePublicRead(request, run, { cors: true });
  }
  const resolved = deps ?? runtimeAccessDeps();
  const ip = clientIpFromRequest(request);
  try {
    const principal = requirePrincipal(
      await authenticateBearer(request.headers.get("authorization"), ip, resolved),
    );
    const url = new URL(request.url);
    const rateHeaders = keyedRateLimitHeaders("read");
    const result = await runAuthed(
      { principal, klass: "read", route: `GET ${url.pathname}`, bountyId: null, ip },
      resolved,
      async () => {
        const response = await run();
        const body: unknown = await response.json();
        return { status: response.status, body };
      },
    );
    return apiResultResponse({
      ...result,
      headers: { ...rateHeaders, ...result.headers },
    });
  } catch (err) {
    const result = resultFromError(err);
    return apiResultResponse({
      ...result,
      headers: { ...keyedRateLimitHeaders("read"), ...rateHeadersFromError(err), ...result.headers },
    });
  }
}

export type McpAccess = {
  principal: ApiPrincipal | null;
  deps: AccessDeps;
  ip: string;
  origin: string;
};

export async function mcpAccessFromRequest(request: Request, deps?: AccessDeps): Promise<McpAccess | Response> {
  const resolved = deps ?? runtimeAccessDeps();
  const ip = clientIpFromRequest(request);
  const origin = publicOrigin(resolved.env, new URL(request.url).origin);
  try {
    const principal = await authenticateBearer(request.headers.get("authorization"), ip, resolved);
    return { principal, deps: resolved, ip, origin };
  } catch (err) {
    return apiResultResponse(resultFromError(err));
  }
}
