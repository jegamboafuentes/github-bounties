import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { McpAccess } from "../api/access/http";
import { balanceSnapshotJson, readBalanceSnapshot, readOnChainUsdcBalance } from "./balances";
import { softDeleteBounty } from "./delete";
import { isAdminError } from "./errors";
import { cdpNamedAccountClient } from "./fee-account";
import { isAdminIdentity } from "./identity";
import { readPlatformSettings, setPlatformFeeBps, setPlatformPoolBps } from "./settings";
import { executeFeeWithdraw, previewFeeWithdraw } from "./withdraw";

const adminLead = "Requires API key (admin scope). Hidden unless the key owner is an admin.";

function toolJson(value: unknown, isError = false): CallToolResult {
  return { isError, content: [{ type: "text", text: JSON.stringify(value) }] };
}

function fromError(err: unknown): CallToolResult {
  if (isAdminError(err)) {
    return toolJson({ error: err.status === 404 ? "not_found" : err.code, message: err.message }, true);
  }
  return toolJson({ error: "admin_failed", message: err instanceof Error ? err.message : "failed" }, true);
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
      description: `${adminLead} Read the platform fee_bps and pool_bps used to stamp new bounties.`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const email = await adminEmail(access);
      if (!email || !db) return toolJson({ error: "not_found" }, true);
      try {
        const settings = await readPlatformSettings(db);
        return toolJson({ feeBps: settings.feeBps, poolBps: settings.poolBps });
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "admin_set_fee_bps",
    {
      title: "Admin: set fee bps",
      description: `${adminLead} Set the platform fee in basis points (0–1000). Existing bounties keep their stamp.`,
      inputSchema: { feeBps: z.number().int() },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const email = await adminEmail(access);
      if (!email || !db) return toolJson({ error: "not_found" }, true);
      try {
        const settings = await setPlatformFeeBps(db, email, args.feeBps);
        return toolJson({ feeBps: settings.feeBps, poolBps: settings.poolBps });
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "admin_set_pool_bps",
    {
      title: "Admin: set pool bps",
      description: `${adminLead} Set the platform pool share of post-fee in basis points (1000–2000). Existing bounties keep their stamp.`,
      inputSchema: { poolBps: z.number().int() },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const email = await adminEmail(access);
      if (!email || !db) return toolJson({ error: "not_found" }, true);
      try {
        const settings = await setPlatformPoolBps(db, email, args.poolBps);
        return toolJson({ feeBps: settings.feeBps, poolBps: settings.poolBps });
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "admin_delete_bounty",
    {
      title: "Admin: soft-delete an unfunded bounty",
      description: `${adminLead} Soft-delete a bounty only when nothing is funded. Funded bounties return bounty_has_funds_refund_first.`,
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
    "admin_get_balances",
    {
      title: "Admin: read escrow and fee balances",
      description: `${adminLead} Read-only on-chain USDC balances plus database liabilities and earned fees. Escrow cannot be transferred.`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const email = await adminEmail(access);
      if (!email || !db) return toolJson({ error: "not_found" }, true);
      try {
        const snapshot = await readBalanceSnapshot(db, await cdpNamedAccountClient(), env, (address) =>
          readOnChainUsdcBalance(address, env),
        );
        return toolJson(balanceSnapshotJson(snapshot));
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
