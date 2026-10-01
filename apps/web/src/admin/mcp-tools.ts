import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { McpAccess } from "../api/access/http";
import { balanceReportJson, readBalanceReport, readOnChainUsdcBalance } from "./balances";
import { listAdminBounties } from "./bounties";
import { softDeleteBounty } from "./delete";
import { isAdminError } from "./errors";
import { cdpNamedAccountClient } from "./fee-account";
import { isAdminIdentity } from "./identity";
import { adminRefundBounty } from "./refund";
import { platformRatesJson, readPlatformSettings, setPlatformFee, setPlatformPool } from "./settings";
import { executeFeeWithdraw, previewFeeWithdraw } from "./withdraw";

const adminLead = "Requires API key (admin scope). Hidden unless the key owner is an admin.";

function toolJson(value: unknown, isError = false): CallToolResult {
  return { isError, content: [{ type: "text", text: JSON.stringify(value) }] };
}

function fromError(err: unknown): CallToolResult {
  if (isAdminError(err)) {
    return toolJson(
      {
        error: err.status === 404 ? "not_found" : err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
      true,
    );
  }
  console.error(
    JSON.stringify({
      severity: "ERROR",
      event: "admin_action_failed",
      reason: err instanceof Error ? err.message : "failed",
    }),
  );
  return toolJson({ error: "admin_failed", message: "Admin request failed." }, true);
}

async function adminEmail(access: McpAccess | null | undefined): Promise<string | null> {
  const principal = access?.principal;
  if (!principal || !principal.scopes.has("admin")) return null;
  const actor = await access.deps.loadAdminActor?.(principal.userId);
  if (
    !actor ||
    !isAdminIdentity(
      { email: actor.email, googleSub: actor.googleSub, sessionGoogleSub: actor.googleSub },
      access.deps.env,
    )
  ) {
    return null;
  }
  return actor.email.trim().toLowerCase();
}

export function registerAdminMcpTools(server: McpServer, access: McpAccess | null | undefined): void {
  const db = access?.deps.db;
  const env = access?.deps.env ?? process.env;

  server.registerTool(
    "admin_get_settings",
    {
      title: "Admin: get fee and pool settings",
      description: `${adminLead} Read the platform fee and pool used to stamp new bounties. Responses include basis points and percent (2.00 means 2.00%).`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const email = await adminEmail(access);
      if (!email || !db) return toolJson({ error: "not_found" }, true);
      try {
        const settings = await readPlatformSettings(db);
        return toolJson(platformRatesJson(settings, { includeAudit: true }));
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "admin_set_fee_bps",
    {
      title: "Admin: set fee bps",
      description: `${adminLead} Set the platform fee. Accept feeBps (0–1000) or feePercent (0.00–10.00). Existing bounties keep their stamp. Fee must be from 0.00% to 10.00%.`,
      inputSchema: {
        feeBps: z.number().int().optional(),
        feePercent: z.union([z.string(), z.number()]).optional(),
      },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const email = await adminEmail(access);
      if (!email || !db) return toolJson({ error: "not_found" }, true);
      try {
        const settings = await setPlatformFee(db, email, { feeBps: args.feeBps, feePercent: args.feePercent });
        return toolJson(platformRatesJson(settings));
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "admin_set_pool_bps",
    {
      title: "Admin: set pool bps",
      description: `${adminLead} Set the platform pool share of post-fee. Accept poolBps (1000–2000) or poolPercent (10.00–20.00). Existing bounties keep their stamp. Pool must be from 10.00% to 20.00%.`,
      inputSchema: {
        poolBps: z.number().int().optional(),
        poolPercent: z.union([z.string(), z.number()]).optional(),
      },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const email = await adminEmail(access);
      if (!email || !db) return toolJson({ error: "not_found" }, true);
      try {
        const settings = await setPlatformPool(db, email, { poolBps: args.poolBps, poolPercent: args.poolPercent });
        return toolJson(platformRatesJson(settings));
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "admin_delete_bounty",
    {
      title: "Admin: soft-delete a bounty",
      description: `${adminLead} Soft-delete a paid, cancelled, refunded, or never-funded bounty. Blocks with bounty_has_funds_refund_first only while escrow still holds an unrefunded unpaid remainder, an active claim lock, or an in-flight allocation. details.reasons names the block.`,
      inputSchema: { bountyId: z.string().uuid() },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const email = await adminEmail(access);
      if (!email || !db) return toolJson({ error: "not_found" }, true);
      try {
        const deleted = await softDeleteBounty({ bountyId: args.bountyId, actorEmail: email, db });
        return toolJson({ id: deleted.id, deletedAt: deleted.deletedAt.toISOString() });
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "admin_list_bounties",
    {
      title: "Admin: list bounties",
      description: `${adminLead} Paginated bounty list. search matches title, repo, issue number, or id. status is a bounty status. Deleted rows are omitted.`,
      inputSchema: {
        search: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const email = await adminEmail(access);
      if (!email || !db) return toolJson({ error: "not_found" }, true);
      try {
        const page = await listAdminBounties(db, {
          search: args.search,
          status: args.status,
          limit: args.limit,
          offset: args.offset,
        });
        return toolJson(page);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "admin_refund_bounty",
    {
      title: "Admin: refund a bounty",
      description: `${adminLead} Runs the existing refund flow for a funded bounty. The money flag applies. Funds return to the recorded payer. No caller-supplied destination.`,
      inputSchema: { bountyId: z.string().uuid() },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const email = await adminEmail(access);
      if (!email || !db) return toolJson({ error: "not_found" }, true);
      try {
        const refunded = await adminRefundBounty({
          bountyId: args.bountyId,
          actorEmail: email,
          db,
          env,
        });
        return toolJson(refunded);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "admin_get_balances",
    {
      title: "Admin: read escrow and fee balances",
      description: `${adminLead} Read escrow and fee balances. Each tile is independent: a failing tile returns its error and the others still return values. Escrow cannot be transferred.`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const email = await adminEmail(access);
      if (!email || !db) return toolJson({ error: "not_found" }, true);
      try {
        const report = await readBalanceReport(db, env, {
          readBalance: (address) => readOnChainUsdcBalance(address, env),
        });
        return toolJson(balanceReportJson(report));
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "admin_withdraw_fees_preview",
    {
      title: "Admin: preview a fee withdrawal",
      description: `${adminLead} Preview a fee-wallet withdrawal and return a short-lived confirm token. Does not send.`,
      inputSchema: {
        amountUsdc: z.string(),
        destination: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const email = await adminEmail(access);
      if (!email || !db) return toolJson({ error: "not_found" }, true);
      try {
        const preview = await previewFeeWithdraw({
          db,
          env,
          actorEmail: email,
          amountUsdc: args.amountUsdc,
          destination: args.destination,
          client: await cdpNamedAccountClient(),
          readBalance: (address) => readOnChainUsdcBalance(address, env),
        });
        return toolJson(preview);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "admin_withdraw_fees",
    {
      title: "Admin: withdraw fees",
      description: `${adminLead} Send USDC from the fee wallet. Requires the preview confirm token and the destination typed back as confirmation.`,
      inputSchema: {
        confirmToken: z.string(),
        confirmation: z.string(),
      },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const email = await adminEmail(access);
      if (!email || !db) return toolJson({ error: "not_found" }, true);
      try {
        const sent = await executeFeeWithdraw({
          db,
          env,
          actorEmail: email,
          confirmToken: args.confirmToken,
          confirmation: args.confirmation,
          client: await cdpNamedAccountClient(),
          readBalance: (address) => readOnChainUsdcBalance(address, env),
        });
        return toolJson(sent);
      } catch (err) {
        return fromError(err);
      }
    },
  );
}
