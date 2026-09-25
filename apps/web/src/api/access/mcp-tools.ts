import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { publicApiErrorBody, type PublicApiErrorBody } from "../public/errors";
import type { McpAccess } from "./http";
import {
  handleBountyClaims,
  handleCancel,
  handleClaim,
  handleCreateBounty,
  handleFund,
  handleGetNotificationPreferences,
  handleGetProfile,
  handleLinkedAccounts,
  handleMe,
  handleMyBounties,
  handleMyClaims,
  handleRefund,
  handleUpdateNotificationPreferences,
  handleUpdateProfile,
  handleUsage,
  handleTopUp,
  handleWorkSignal,
  requirePrincipal,
  resultFromError,
  runAuthed,
  type ApiResult,
} from "./handlers";
import { PublicApiError } from "../public/errors";
import { logMcpToolCall, mcpOutcomeCode, mcpOutcomeFromBody } from "../public/mcp-log";
import { assertNoAddress, assertNoUserOverride } from "./policy";
import {
  bountyClaimsToolSchema,
  cancelToolSchema,
  claimToolSchema,
  createBountyToolSchema,
  fundToolSchema,
  topUpToolSchema,
  updateNotificationToolSchema,
  updateProfileToolSchema,
  workSignalToolSchema,
} from "./openapi";

const emptyToolSchema = z.object({}).passthrough();
const looseCreate = createBountyToolSchema.passthrough();
const looseWork = workSignalToolSchema.passthrough();
const looseCancel = cancelToolSchema.passthrough();
const looseFund = fundToolSchema.passthrough();
const looseTopUp = topUpToolSchema.passthrough();
const looseClaim = claimToolSchema.passthrough();
const looseClaims = bountyClaimsToolSchema.passthrough();

/** Unknown keys are a validation_failed for this tool's rate class, not a JSON-RPC -32602. */
export function rejectUnknownToolArgs(args: object, allowed: readonly string[]): void {
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  throw new PublicApiError(
    "validation_failed",
    `Unknown argument: ${unknown.join(", ")}.`,
    { unknown },
  );
}

function toolJson(value: unknown, isError = false): CallToolResult {
  return { isError, content: [{ type: "text", text: JSON.stringify(value) }] };
}

function fromResult(result: ApiResult): CallToolResult {
  const body = result.body as { error?: PublicApiErrorBody["error"] } | null;
  const failed = result.status >= 400 || Boolean(body && typeof body === "object" && "error" in body);
  return toolJson(result.body, failed);
}

function missingKeyBody(klass: "read" | "write" | "money"): PublicApiErrorBody {
  const lead =
    klass === "money"
      ? "Requires API key with money scope; DEV only."
      : `Requires API key (${klass} scope).`;
  return publicApiErrorBody(
    "unauthorized",
    `${lead} Send Authorization: Bearer <api key>. Cookies are not accepted.`,
    { scope: klass },
  );
}

function toolNameFromRoute(route: string): string {
  return /tool:([a-z0-9_]+)/.exec(route)?.[1] ?? "unknown";
}

async function guarded(
  access: McpAccess | null | undefined,
  klass: "read" | "write" | "money",
  route: string,
  bountyId: string | null,
  run: () => Promise<ApiResult>,
): Promise<CallToolResult> {
  const started = Date.now();
  const principal = access?.principal ?? null;
  const emit = (outcome: string) => {
    logMcpToolCall({
      tool: toolNameFromRoute(route),
      apiKeyId: principal?.keyId ?? null,
      userId: principal?.userId ?? null,
      outcome,
      latencyMs: Math.max(0, Date.now() - started),
      rateClass: klass,
    });
  };
  try {
    if (!principal || !access) {
      emit("unauthorized");
      return toolJson(missingKeyBody(klass), true);
    }
    const result = await runAuthed(
      { principal: requirePrincipal(principal), klass, route, bountyId, ip: access.ip },
      access.deps,
      run,
    );
    emit(result.status >= 400 ? mcpOutcomeFromBody(result.body) : "ok");
    return fromResult(result);
  } catch (err) {
    emit(mcpOutcomeCode(err));
    return fromResult(resultFromError(err));
  }
}

/** Write and money tools. Same handlers as REST. Auth, scopes, and the request log match. */
export function registerAuthedMcpTools(server: McpServer, access?: McpAccess | null): void {
  server.registerTool(
    "get_me",
    {
      title: "Current key owner",
      description:
        "Requires API key (read scope). The human user that owns this API key. Does not include google_sub.",
      inputSchema: emptyToolSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guarded(access, "read", "tool:get_me", null, () => {
        rejectUnknownToolArgs(args, []);
        return handleMe(requirePrincipal(access?.principal), access!.deps);
      }),
  );

  server.registerTool(
    "get_my_usage",
    {
      title: "This key's spend usage",
      description:
        "Requires API key (read scope). Effective per-transaction cap, daily cap, USDC spent today (UTC, from api_spend_ledger), remaining today, and up to 50 recent fund or top_up ledger entries for this key only. Each entry has amount, kind, bounty id, tx hash, and time. Does not include other users.",
      inputSchema: emptyToolSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guarded(access, "read", "tool:get_my_usage", null, () => {
        rejectUnknownToolArgs(args, []);
        return handleUsage(requirePrincipal(access?.principal), access!.deps);
      }),
  );

  server.registerTool(
    "list_my_bounties",
    {
      title: "List my bounties",
      description:
        "Requires API key (read scope). Bounties this key's user posted, and contributions they funded. No wallet addresses.",
      inputSchema: emptyToolSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guarded(access, "read", "tool:list_my_bounties", null, () => {
        rejectUnknownToolArgs(args, []);
        return handleMyBounties(requirePrincipal(access?.principal), access!.deps);
      }),
  );

  server.registerTool(
    "create_bounty",
    {
      title: "Post a bounty",
      description:
        "Requires API key (write scope). Creates pending_fund only, using the same create path as the website. Body is issueUrl and amountUsdc. Do not send an address.",
      inputSchema: looseCreate,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "write", "tool:create_bounty", null, () => {
        rejectUnknownToolArgs(args, ["issueUrl", "amountUsdc"]);
        assertNoAddress(args);
        return handleCreateBounty(requirePrincipal(access?.principal), args, access!.deps);
      }),
  );

  server.registerTool(
    "signal_working",
    {
      title: "Signal Working on this",
      description:
        "Requires API key (write scope). Optional non-exclusive signal. Does not move money or change pool eligibility.",
      inputSchema: looseWork,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "write", `tool:signal_working ${args.id}`, args.id, () => {
        rejectUnknownToolArgs(args, ["id"]);
        return handleWorkSignal(requirePrincipal(access?.principal), args.id, "POST", access!.deps);
      }),
  );

  server.registerTool(
    "clear_work_signal",
    {
      title: "Clear Working on this",
      description: "Requires API key (write scope). Clears the caller's active signal. Idempotent.",
      inputSchema: looseWork,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "write", `tool:clear_work_signal ${args.id}`, args.id, () => {
        rejectUnknownToolArgs(args, ["id"]);
        return handleWorkSignal(requirePrincipal(access?.principal), args.id, "DELETE", access!.deps);
      }),
  );

  server.registerTool(
    "cancel_bounty",
    {
      title: "Cancel an unfunded bounty",
      description:
        "Requires API key (write scope). Only pending_fund. Funded cancel is refund_bounty. A bounty that is already cancelled returns already_cancelled. idempotencyKey is required and matches the REST Idempotency-Key.",
      inputSchema: looseCancel,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "write", `tool:cancel_bounty ${args.id}`, args.id, () => {
        rejectUnknownToolArgs(args, ["id", "idempotencyKey"]);
        return handleCancel(requirePrincipal(access?.principal), args.id, args.idempotencyKey, access!.deps);
      }),
  );

  server.registerTool(
    "fund_bounty",
    {
      title: "Fund a bounty with x402",
      description:
        "Requires API key with money scope; DEV only. Omit paymentSignature to get payment requirements and approval_url. Retry with the same idempotencyKey and the x402 payment signature. Poster only. No address in the arguments. Settles then calls the same lock as the website. Stays off on mainnet until API_MONEY_ENABLED is turned on.",
      inputSchema: looseFund,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "money", `tool:fund_bounty ${args.id}`, args.id, () => {
        rejectUnknownToolArgs(args, ["id", "idempotencyKey", "paymentSignature"]);
        assertNoAddress(args);
        return handleFund(
          requirePrincipal(access?.principal),
          args.id,
          {},
          args.idempotencyKey,
          args.paymentSignature ?? null,
          access?.origin ?? "https://dev.githubbounties.xyz",
          access!.deps,
        );
      }),
  );

  server.registerTool(
    "top_up_bounty",
    {
      title: "Top up a funded bounty with x402",
      description:
        "Requires API key with money scope; DEV only. amountUsdc is the added face. Same 402 then settle flow as fund. Uses the same top-up service as the website. No address in the arguments. Stays off on mainnet until API_MONEY_ENABLED is turned on.",
      inputSchema: looseTopUp,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "money", `tool:top_up_bounty ${args.id}`, args.id, () => {
        rejectUnknownToolArgs(args, ["id", "idempotencyKey", "paymentSignature", "amountUsdc"]);
        assertNoAddress(args);
        return handleTopUp(
          requirePrincipal(access?.principal),
          args.id,
          { amountUsdc: args.amountUsdc },
          args.idempotencyKey,
          args.paymentSignature ?? null,
          access?.origin ?? "https://dev.githubbounties.xyz",
          access!.deps,
        );
      }),
  );

  server.registerTool(
    "claim_winner",
    {
      title: "Claim the winner share",
      description:
        "Requires API key with money scope; DEV only. Pays the winner share to the wallet saved for this key's user. The linked GitHub login must match the merged pull request author. idempotencyKey is required. Do not send an address, destination, or user id. The result lists every leg in scope (winner, fee, and pool when included) with status paid, failed, or pending.",
      inputSchema: looseClaim,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "money", `tool:claim_winner ${args.id}`, args.id, () => {
        rejectUnknownToolArgs(args, ["id", "idempotencyKey"]);
        assertNoAddress(args);
        assertNoUserOverride(args);
        return handleClaim(
          requirePrincipal(access?.principal),
          args.id,
          { kind: "winner" },
          args.idempotencyKey,
          access!.deps,
        );
      }),
  );

  server.registerTool(
    "claim_pool",
    {
      title: "Claim the caller's pool share",
      description:
        "Requires API key with money scope; DEV only. Pays this key owner's frozen pool share to their saved wallet. It does not pay any other member. idempotencyKey is required. Do not send an address, destination, or user id. The result lists that pool leg with status paid, failed, or pending.",
      inputSchema: looseClaim,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "money", `tool:claim_pool ${args.id}`, args.id, () => {
        rejectUnknownToolArgs(args, ["id", "idempotencyKey"]);
        assertNoAddress(args);
        assertNoUserOverride(args);
        return handleClaim(
          requirePrincipal(access?.principal),
          args.id,
          { kind: "pool" },
          args.idempotencyKey,
          access!.deps,
        );
      }),
  );

  server.registerTool(
    "refund_bounty",
    {
      title: "Refund a funded bounty",
      description:
        "Requires API key with money scope; DEV only. Poster only. The refund goes to the recorded on-chain payer, never a caller-supplied address. idempotencyKey is required. A bounty already refunding resumes: legs that already have a refund tx are skipped and only the remaining recorded payers are paid. The result includes a legs array for every destination. A single payer also sets destination and refundTxHash to that leg. More than one payer sets both to null; read legs. Unfunded drafts use cancel_bounty.",
      inputSchema: looseClaim,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "money", `tool:refund_bounty ${args.id}`, args.id, () => {
        rejectUnknownToolArgs(args, ["id", "idempotencyKey"]);
        assertNoAddress(args);
        assertNoUserOverride(args);
        return handleRefund(requirePrincipal(access?.principal), args.id, {}, args.idempotencyKey, access!.deps);
      }),
  );

  server.registerTool(
    "get_bounty_claims",
    {
      title: "Payout status for my legs",
      description:
        "Requires API key (read scope). This caller's winner and pool legs on one bounty: status, amount, tx hash, and destination (the address paid or the saved wallet to be paid). The fee leg is not included. Other hunters are omitted.",
      inputSchema: looseClaims,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guarded(access, "read", `tool:get_bounty_claims ${args.id}`, args.id, () => {
        rejectUnknownToolArgs(args, ["id"]);
        return handleBountyClaims(requirePrincipal(access?.principal), args.id, access!.deps);
      }),
  );

  server.registerTool(
    "list_my_claims",
    {
      title: "My claims",
      description:
        "Requires API key (read scope). This caller's claims across bounties, with status, tx hash, and destination (the address paid or the saved wallet to be paid). The fee leg is not included.",
      inputSchema: emptyToolSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guarded(access, "read", "tool:list_my_claims", null, () => {
        rejectUnknownToolArgs(args, []);
        return handleMyClaims(requirePrincipal(access?.principal), access!.deps);
      }),
  );

  server.registerTool(
    "get_profile",
    {
      title: "Display name and email",
      description:
        "Requires API key (read scope). The key owner's display name and full Google email. Does not include google_sub or a wallet. displayNameCustom is true after a saved name.",
      inputSchema: emptyToolSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guarded(access, "read", "tool:get_profile", null, () => {
        rejectUnknownToolArgs(args, []);
        return handleGetProfile(requirePrincipal(access?.principal), access!.deps);
      }),
  );

  server.registerTool(
    "update_profile",
    {
      title: "Set the display name",
      description:
        "Requires API key (write scope). Sets the display name. A wallet or payout-address field is rejected. Idempotency key is not used. Does not change the payout wallet.",
      inputSchema: updateProfileToolSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guarded(access, "write", "tool:update_profile", null, () =>
        handleUpdateProfile(requirePrincipal(access?.principal), args, access!.deps),
      ),
  );

  server.registerTool(
    "get_notification_preferences",
    {
      title: "Email notification preferences",
      description:
        "Requires API key (read scope). Four bounty email flags. A missing row is all true. Welcome is always on and is not listed.",
      inputSchema: emptyToolSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guarded(access, "read", "tool:get_notification_preferences", null, () => {
        rejectUnknownToolArgs(args, []);
        return handleGetNotificationPreferences(requirePrincipal(access?.principal), access!.deps);
      }),
  );

  server.registerTool(
    "update_notification_preferences",
    {
      title: "Update email notification preferences",
      description:
        "Requires API key (write scope). Partial update of bounty email flags. At least one boolean is required. Wallet fields are rejected. Welcome cannot be turned off.",
      inputSchema: updateNotificationToolSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guarded(access, "write", "tool:update_notification_preferences", null, () =>
        handleUpdateNotificationPreferences(requirePrincipal(access?.principal), args, access!.deps),
      ),
  );

  server.registerTool(
    "list_linked_accounts",
    {
      title: "Linked accounts",
      description:
        "Requires API key (read scope). GitHub login, id, and linkedAt, the full Google email, and the saved wallet address. Read-only. Linking, unlinking, and wallet changes are not tools.",
      inputSchema: emptyToolSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guarded(access, "read", "tool:list_linked_accounts", null, () => {
        rejectUnknownToolArgs(args, []);
        return handleLinkedAccounts(requirePrincipal(access?.principal), access!.deps);
      }),
  );
}
