import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAccess } from "../access/http";
import { registerAuthedMcpTools } from "../access/mcp-tools";
import { mcpBountyId, runLoggedMcpTool } from "./mcp-log";
import { acceptBountyId, acceptListInput } from "./query";
import type { PublicReadApi } from "./service";
import { listBountiesInputSchema, bountyIdParamsSchema } from "./schemas";
import { PUBLIC_API_VERSION } from "./version";

const INSTRUCTIONS = [
  "GitHub Bounties tools. Anonymous calls can read the public board and can list every tool. Tools that need a key say so at the start of the description. Calling one without Authorization: Bearer returns unauthorized and does not run the handler. No cookies.",
  "list_bounties filters the public board. get_bounty reads one bounty, including the stored issue body, payout breakdown, and pool roster.",
  "list_funders returns public contribution rows (name, GitHub login, avatar, amount, time), newest first.",
  "get_bounty_intelligence reads the Gemini cache only and must not be treated as a refresh.",
  "get_stats returns platform totals.",
  "get_me, get_my_usage, list_my_bounties, get_bounty_claims, and list_my_claims read the key owner. get_my_usage needs only the read scope. create_bounty, signal_working, clear_work_signal, and cancel_bounty need the write scope. cancel_bounty is unfunded only and returns already_cancelled when the bounty is already cancelled.",
  "get_profile and get_notification_preferences read the key owner. update_profile and update_notification_preferences need the write scope. list_linked_accounts is read-only. Wallet changes, GitHub link, and GitHub unlink are not tools.",
  "fund_bounty, top_up_bounty, claim_winner, claim_pool, and refund_bounty need the money scope and stay off on mainnet until API_MONEY_ENABLED is turned on. Fund and top-up are headless x402: call once for payment requirements, then retry with the same idempotencyKey and paymentSignature. Claims pay the saved wallet. Refunds pay the recorded payer. claim_winner, claim_pool, and refund_bounty return a legs array. A refund of a bounty already in refunding skips legs that already have a refund tx. Unknown arguments are validation_failed. The exclusive claim-lock is retired. Wallet changes are not tools.",
].join(" ");

export function createBountiesMcpServer(api: PublicReadApi, access?: McpAccess | null): McpServer {
  const server = new McpServer(
    { name: "github-bounties", version: PUBLIC_API_VERSION },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "list_bounties",
    {
      title: "List bounties",
      description:
        "List public GitHub Bounties. Filter by repo (case-insensitive substring of owner/name), status, complexity S/M/L, language (substring of the cached stack), and has_intel. Sort by newest (default) or amount (face USDC, descending). amountUsdc is the face. totalFundedUsdc is the verified escrow fund plus confirmed contributions, each fund hash once, or 0.000000 when there is no verified inflow. It is not the face. status cancelled, expired, refunding, or refunded means that confirmed amount is not still locked. funders.avatars are distinct faces, newest contribution first. Pass nextCursor back as cursor to read the next page. limit defaults to 20 and cannot exceed 100. Read-only. Does not call Gemini. Cache badges only.",
      inputSchema: listBountiesInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      runLoggedMcpTool({
        tool: "list_bounties",
        rateClass: "read",
        access,
        recordRequest: true,
        run: () => api.listBounties(acceptListInput(args)),
      }),
  );

  server.registerTool(
    "get_bounty",
    {
      title: "Get bounty",
      description:
        "Read one public bounty by id. Includes the stored issue body (no GitHub refetch), status, fee and pool payout breakdown, pool roster, escrow status, and the retired claim-lock state (always read-only). amountUsdc and payout.faceUsdc are the face. totalFundedUsdc is the verified escrow fund plus confirmed contributions, each fund hash once, or 0.000000 when there is no verified inflow. status cancelled, expired, refunding, or refunded means that amount is not still locked. funders.avatars are newest contribution first. Omits wallet addresses, emails, and Google ids.",
      inputSchema: bountyIdParamsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      runLoggedMcpTool({
        tool: "get_bounty",
        rateClass: "read",
        access,
        bountyId: mcpBountyId(args.id),
        recordRequest: true,
        run: () => api.getBounty(acceptBountyId(args.id)),
      }),
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
    async (args) =>
      runLoggedMcpTool({
        tool: "list_funders",
        rateClass: "read",
        access,
        bountyId: mcpBountyId(args.id),
        recordRequest: true,
        run: () => api.listFunders(acceptBountyId(args.id)),
      }),
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
    async (args) =>
      runLoggedMcpTool({
        tool: "get_bounty_intelligence",
        rateClass: "read",
        access,
        bountyId: mcpBountyId(args.id),
        recordRequest: true,
        run: () => api.getIntelligence(acceptBountyId(args.id)),
      }),
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
    async () =>
      runLoggedMcpTool({
        tool: "get_stats",
        rateClass: "read",
        access,
        recordRequest: true,
        run: () => api.getStats(),
      }),
  );

  registerAuthedMcpTools(server, access);
  return server;
}
