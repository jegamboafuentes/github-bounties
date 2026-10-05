import { keyedRateLimitHeaders, type ApiClass } from "../access/policy";
import { publicApiErrorBody } from "./errors";

/** Tool name → keyed rate class. Money is 10/hour, write 20/minute, read 120/minute. */
export const MCP_TOOL_CLASS: Record<string, ApiClass> = {
  get_me: "read",
  get_my_usage: "read",
  list_my_bounties: "read",
  get_bounty_claims: "read",
  list_my_claims: "read",
  create_bounty: "write",
  signal_working: "write",
  clear_work_signal: "write",
  cancel_bounty: "write",
  update_bounty_amount: "write",
  fund_bounty: "money",
  top_up_bounty: "money",
  claim_winner: "money",
  claim_pool: "money",
  refund_bounty: "money",
  get_profile: "read",
  get_notification_preferences: "read",
  list_linked_accounts: "read",
  list_submissions: "read",
  update_profile: "write",
  update_notification_preferences: "write",
  submit_pr: "write",
  withdraw_submission: "write",
};

export function toolClassForMcpTool(name: string | null | undefined): ApiClass {
  if (name && name in MCP_TOOL_CLASS) return MCP_TOOL_CLASS[name]!;
  return "read";
}

/** Uncounted headers for a JSON-RPC -32602 that never reached the tool handler. */
export function invalidParamsRateHeaders(name: string | null | undefined): Record<string, string> {
  return keyedRateLimitHeaders(toolClassForMcpTool(name));
}

export function toolNameFromMcpRequest(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as { method?: unknown; params?: { name?: unknown } };
  if (record.method !== "tools/call") return null;
  return typeof record.params?.name === "string" ? record.params.name : null;
}

function validationResult(message: string): {
  isError: true;
  content: { type: "text"; text: string }[];
} {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(publicApiErrorBody("validation_failed", message)),
      },
    ],
  };
}

function rewriteOne(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as {
    error?: { code?: unknown; message?: unknown };
    result?: { isError?: boolean; content?: { text?: string }[] };
  };
  if (record.error?.code === -32602) {
    const message =
      typeof record.error.message === "string" && record.error.message.trim()
        ? record.error.message
        : "Invalid params.";
    const { error: _error, ...rest } = record as Record<string, unknown>;
    return { ...rest, result: validationResult(message) };
  }
  const text = record.result?.isError ? record.result.content?.[0]?.text : undefined;
  if (typeof text === "string" && text.startsWith("MCP error -32602")) {
    const message = text.replace(/^MCP error -32602:\s*/, "").trim() || "Invalid params.";
    return { ...record, result: validationResult(message) };
  }
  return body;
}

/**
 * SDK schema rejection never enters the tool handler, so it cannot publish
 * that tool's rate class. A JSON-RPC -32602, or the same code embedded in a
 * tool result (`MCP error -32602: ...`), is rewritten to `validation_failed`.
 */
export function rewriteInvalidParamsBody(body: unknown): unknown {
  if (Array.isArray(body)) {
    let changed = false;
    const next = body.map((item) => {
      const rewritten = rewriteOne(item);
      if (rewritten !== item) changed = true;
      return rewritten;
    });
    return changed ? next : body;
  }
  return rewriteOne(body);
}

export async function rewriteMcpInvalidParamsResponse(
  response: Response,
): Promise<{ response: Response; rewritten: boolean }> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) return { response, rewritten: false };
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { response: cloneResponse(response, text), rewritten: false };
  }
  const next = rewriteInvalidParamsBody(parsed);
  if (next === parsed) return { response: cloneResponse(response, text), rewritten: false };
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return {
    response: new Response(JSON.stringify(next), {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
    rewritten: true,
  };
}

function cloneResponse(response: Response, text: string): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
