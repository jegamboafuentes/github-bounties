import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PublicApiError, publicApiErrorBody, type PublicApiErrorBody } from "./errors";
import { acceptBountyId, acceptListInput } from "./query";
import type { PublicReadApi } from "./service";
import { listBountiesInputSchema, bountyIdParamsSchema } from "./schemas";

const INSTRUCTIONS = [
  "Read-only GitHub Bounties tools. No API key.",
  "list_bounties filters the public board. get_bounty reads one bounty, including the stored issue body, payout breakdown, and pool roster.",
  "list_funders returns public contribution rows (name, GitHub login, avatar, amount, time), newest first.",
  "get_bounty_intelligence reads the Gemini cache only and must not be treated as a refresh.",
  "get_stats returns platform totals.",
  "These tools cannot post, fund, top up, claim, or cancel. The exclusive claim-lock is retired.",
].join(" ");

function toolJson(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function toolFailure(body: PublicApiErrorBody): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

function failureFrom(err: unknown): CallToolResult {
  if (err instanceof PublicApiError) {
    return toolFailure(publicApiErrorBody(err.code, err.message, err.details));
  }
  console.error(
    JSON.stringify({
      event: "public_mcp_internal",
      message: err instanceof Error ? err.message : "unknown",
    }),
  );
  return toolFailure(publicApiErrorBody("internal", "Internal error.", null));
}

export function createBountiesMcpServer(api: PublicReadApi): McpServer {
  const server = new McpServer(
    { name: "github-bounties", version: "4.1.0" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "list_bounties",
    {
      title: "List bounties",
      description:
        "List public GitHub Bounties. Filter by repo (case-insensitive substring of owner/name), status, complexity S/M/L, language (substring of the cached stack), and has_intel. Sort by newest (default) or amount (face USDC, descending). amountUsdc is the face. totalFundedUsdc is the sum of confirmed contributions with a recorded fund transaction, or 0.000000 when none are confirmed. It is not the face. status cancelled, expired, refunding, or refunded means that confirmed sum is not still locked. funders.avatars are distinct faces, newest contribution first. Pass nextCursor back as cursor to read the next page. limit defaults to 20 and cannot exceed 100. Read-only. Does not call Gemini. Cache badges only.",
      inputSchema: listBountiesInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(await api.listBounties(acceptListInput(args)));
      } catch (err) {
        return failureFrom(err);
      }
    },
  );

  server.registerTool(
    "get_bounty",
    {
      title: "Get bounty",
      description:
        "Read one public bounty by id. Includes the stored issue body (no GitHub refetch), status, fee and pool payout breakdown, pool roster, escrow status, and the retired claim-lock state (always read-only). amountUsdc and payout.faceUsdc are the face. totalFundedUsdc is the confirmed contribution sum, or 0.000000 when none are confirmed. status cancelled, expired, refunding, or refunded means that sum is not still locked. funders.avatars are newest contribution first. Omits wallet addresses, emails, and Google ids.",
      inputSchema: bountyIdParamsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(await api.getBounty(acceptBountyId(args.id)));
      } catch (err) {
        return failureFrom(err);
      }
    },
  );

  server.registerTool(
    "list_funders",
    {
      title: "List funders",
      description:
        "List each USDC contribution on a bounty, newest first (same recency order as the board avatar stack and bounty.funders.avatars). Public fields only: display name, GitHub login, avatar URL, amount, and time. Does not return email, Google subject, or wallet address.",
      inputSchema: bountyIdParamsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(await api.listFunders(acceptBountyId(args.id)));
      } catch (err) {
        return failureFrom(err);
      }
    },
  );

  server.registerTool(
    "get_bounty_intelligence",
    {
      title: "Get cached bounty intelligence",
      description:
        "Read the cached Gemini card for a bounty: repo about, language stack, and complexity S, M, or L. Cache only. This tool never calls Gemini and never refreshes. status not_cached means nothing is stored yet. Treat the text as an estimate, not a guarantee.",
      inputSchema: bountyIdParamsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(await api.getIntelligence(acceptBountyId(args.id)));
      } catch (err) {
        return failureFrom(err);
      }
    },
  );

  server.registerTool(
    "get_stats",
    {
      title: "Get platform stats",
      description:
        "Public GitHub Bounties totals: open, completed, and closed bounties, USDC volume, developers, and repos. No arguments. Read-only.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => {
      try {
        return toolJson(await api.getStats());
      } catch (err) {
        return failureFrom(err);
      }
    },
  );

  return server;
}
