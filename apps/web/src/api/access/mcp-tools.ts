import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { publicApiErrorBody, type PublicApiErrorBody } from "../public/errors";
import type { McpAccess } from "./http";
import {
  handleCancel,
  handleCreateBounty,
  handleFund,
  handleMe,
  handleMyBounties,
  handleUsage,
  handleTopUp,
  handleWorkSignal,
  requirePrincipal,
  resultFromError,
  runAuthed,
  type ApiResult,
} from "./handlers";
import {
  cancelToolSchema,
  createBountyToolSchema,
  fundToolSchema,
  topUpToolSchema,
  workSignalToolSchema,
} from "./openapi";

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

async function guarded(
  access: McpAccess | null | undefined,
  klass: "read" | "write" | "money",
  route: string,
  bountyId: string | null,
  run: () => Promise<ApiResult>,
): Promise<CallToolResult> {
  try {
    if (!access?.principal) {
      return toolJson(missingKeyBody(klass), true);
    }
    const principal = requirePrincipal(access.principal);
    const result = await runAuthed(
      { principal, klass, route, bountyId, ip: access.ip },
      access.deps,
      run,
    );
    return fromResult(result);
  } catch (err) {
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
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => guarded(access, "read", "tool:get_me", null, () => handleMe(requirePrincipal(access?.principal), access!.deps)),
  );

  server.registerTool(
    "get_my_usage",
    {
      title: "This key's spend usage",
      description:
        "Requires API key (read scope). Effective per-transaction cap, daily cap, USDC spent today (UTC, from api_spend_ledger), remaining today, and up to 50 recent fund or top_up ledger entries for this key only. Each entry has amount, kind, bounty id, tx hash, and time. Does not include other users.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () =>
      guarded(access, "read", "tool:get_my_usage", null, () =>
        handleUsage(requirePrincipal(access?.principal), access!.deps),
      ),
  );

  server.registerTool(
    "list_my_bounties",
    {
      title: "List my bounties",
      description:
        "Requires API key (read scope). Bounties this key's user posted, and contributions they funded. No wallet addresses.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () =>
      guarded(access, "read", "tool:list_my_bounties", null, () =>
        handleMyBounties(requirePrincipal(access?.principal), access!.deps),
      ),
  );

  server.registerTool(
    "create_bounty",
    {
      title: "Post a bounty",
      description:
        "Requires API key (write scope). Creates pending_fund only, using the same create path as the website. Body is issueUrl and amountUsdc. Do not send an address.",
      inputSchema: createBountyToolSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "write", "tool:create_bounty", null, () =>
        handleCreateBounty(requirePrincipal(access?.principal), args, access!.deps),
      ),
  );

  server.registerTool(
    "signal_working",
    {
      title: "Signal Working on this",
      description:
        "Requires API key (write scope). Optional non-exclusive signal. Does not move money or change pool eligibility.",
      inputSchema: workSignalToolSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "write", `tool:signal_working ${args.id}`, args.id, () =>
        handleWorkSignal(requirePrincipal(access?.principal), args.id, "POST", access!.deps),
      ),
  );

  server.registerTool(
    "clear_work_signal",
    {
      title: "Clear Working on this",
      description: "Requires API key (write scope). Clears the caller's active signal. Idempotent.",
      inputSchema: workSignalToolSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "write", `tool:clear_work_signal ${args.id}`, args.id, () =>
        handleWorkSignal(requirePrincipal(access?.principal), args.id, "DELETE", access!.deps),
      ),
  );

  server.registerTool(
    "cancel_bounty",
    {
      title: "Cancel an unfunded bounty",
      description:
        "Requires API key (write scope). Only pending_fund. Funded cancel is not available. A bounty that is already cancelled returns already_cancelled. idempotencyKey is required and matches the REST Idempotency-Key.",
      inputSchema: cancelToolSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "write", `tool:cancel_bounty ${args.id}`, args.id, () =>
        handleCancel(requirePrincipal(access?.principal), args.id, args.idempotencyKey, access!.deps),
      ),
  );

  server.registerTool(
    "fund_bounty",
    {
      title: "Fund a bounty with x402",
      description:
        "Requires API key with money scope; DEV only. Omit paymentSignature to get payment requirements and approval_url. Retry with the same idempotencyKey and the x402 payment signature. Poster only. No address in the arguments. Settles then calls the same lock as the website. Stays off on mainnet until API_MONEY_ENABLED is turned on.",
      inputSchema: fundToolSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "money", `tool:fund_bounty ${args.id}`, args.id, () =>
        handleFund(
          requirePrincipal(access?.principal),
          args.id,
          {},
          args.idempotencyKey,
          args.paymentSignature ?? null,
          access?.origin ?? "https://dev.githubbounties.xyz",
          access!.deps,
        ),
      ),
  );

  server.registerTool(
    "top_up_bounty",
    {
      title: "Top up a funded bounty with x402",
      description:
        "Requires API key with money scope; DEV only. amountUsdc is the added face. Same 402 then settle flow as fund. Uses the same top-up service as the website. No address in the arguments. Stays off on mainnet until API_MONEY_ENABLED is turned on.",
      inputSchema: topUpToolSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guarded(access, "money", `tool:top_up_bounty ${args.id}`, args.id, () =>
        handleTopUp(
          requirePrincipal(access?.principal),
          args.id,
          { amountUsdc: args.amountUsdc },
          args.idempotencyKey,
          args.paymentSignature ?? null,
          access?.origin ?? "https://dev.githubbounties.xyz",
          access!.deps,
        ),
      ),
  );
}
