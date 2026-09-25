import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { runAuthed, type ApiPrincipal } from "../access/handlers";
import type { McpAccess } from "../access/http";
import type { ApiClass } from "../access/policy";
import { PublicApiError, publicApiErrorBody } from "./errors";

/** Fields written for one MCP tool call. Arguments and bodies are never included. */
export type McpToolLog = {
  tool: string;
  apiKeyId: string | null;
  userId: string | null;
  outcome: string;
  latencyMs: number;
  rateClass: ApiClass;
};

const LOG_KEYS = ["event", "tool", "apiKeyId", "userId", "outcome", "latencyMs", "rateClass"] as const;

export function logMcpToolCall(entry: McpToolLog): void {
  const line: Record<(typeof LOG_KEYS)[number], string | number | null> = {
    event: "mcp_tool_call",
    tool: entry.tool,
    apiKeyId: entry.apiKeyId,
    userId: entry.userId,
    outcome: entry.outcome,
    latencyMs: entry.latencyMs,
    rateClass: entry.rateClass,
  };
  console.log(JSON.stringify(line));
}

export function mcpOutcomeCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string" && err.code.trim()) {
    return err.code;
  }
  return "error";
}

export function mcpOutcomeFromBody(body: unknown): string {
  if (!body || typeof body !== "object") return "error";
  const error = (body as { error?: { code?: unknown } }).error;
  if (error && typeof error.code === "string" && error.code.trim()) return error.code;
  return "error";
}

const BOUNTY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Store a bounty id on the request-log row only when it is a uuid. Invalid input stays null. */
export function mcpBountyId(value: unknown): string | null {
  return typeof value === "string" && BOUNTY_ID.test(value) ? value : null;
}

function toolJson(value: unknown, isError = false): CallToolResult {
  return { isError, content: [{ type: "text", text: JSON.stringify(value) }] };
}

function failureFrom(err: unknown): CallToolResult {
  if (err instanceof PublicApiError) {
    return toolJson(publicApiErrorBody(err.code, err.message, err.details), true);
  }
  console.error(
    JSON.stringify({
      event: "public_mcp_internal",
      message: err instanceof Error ? err.message : "unknown",
    }),
  );
  return toolJson(publicApiErrorBody("internal", "Internal error.", null), true);
}

/**
 * One structured line per tool call. When `recordRequest` is set and a key is
 * present, also insert the same `api_request_log` row REST uses. Authed tools
 * already do that inside `runAuthed`, so they pass `recordRequest: false`.
 */
export async function runLoggedMcpTool(input: {
  tool: string;
  rateClass: ApiClass;
  access: McpAccess | null | undefined;
  bountyId?: string | null;
  recordRequest: boolean;
  run: () => Promise<unknown>;
}): Promise<CallToolResult> {
  const started = Date.now();
  const principal: ApiPrincipal | null = input.access?.principal ?? null;
  const emit = (outcome: string) => {
    logMcpToolCall({
      tool: input.tool,
      apiKeyId: principal?.keyId ?? null,
      userId: principal?.userId ?? null,
      outcome,
      latencyMs: Math.max(0, Date.now() - started),
      rateClass: input.rateClass,
    });
  };
  try {
    if (input.recordRequest && principal && input.access) {
      const result = await runAuthed(
        {
          principal,
          klass: input.rateClass,
          route: `tool:${input.tool}`,
          bountyId: input.bountyId ?? null,
          ip: input.access.ip,
        },
        input.access.deps,
        async () => ({ status: 200, body: await input.run() }),
      );
      const failed = result.status >= 400;
      emit(failed ? mcpOutcomeFromBody(result.body) : "ok");
      return toolJson(result.body, failed);
    }
    const body = await input.run();
    emit("ok");
    return toolJson(body);
  } catch (err) {
    emit(mcpOutcomeCode(err));
    return failureFrom(err);
  }
}
