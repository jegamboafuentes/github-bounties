/**
 * Browser and Next.js document requests for `/mcp` render the setup page.
 * MCP streamable HTTP (Accept includes text/event-stream, or no document
 * header) stays on `app/mcp/route.ts`. These rewrites are beforeFiles so they
 * run ahead of that route. `/mcp` stays out of the Auth.js proxy matcher.
 */
export type McpPageRewrite = {
  source: "/mcp";
  destination: "/mcp-page";
  has: Array<{ type: "header"; key: string; value?: string }>;
};

export function mcpDocumentRewrites(): McpPageRewrite[] {
  const rule = (key: string, value?: string): McpPageRewrite => ({
    source: "/mcp",
    destination: "/mcp-page",
    has: [{ type: "header", key, ...(value ? { value } : {}) }],
  });
  return [
    rule("accept", ".*text/html.*"),
    rule("accept", ".*text/x-component.*"),
    rule("rsc"),
    rule("next-router-prefetch"),
    rule("next-url"),
  ];
}

/** Same match Next.js uses for rewrite `has` (`^value$` against the header). */
export function mcpPageRewriteDestination(headers: {
  get(name: string): string | null;
}): "/mcp-page" | null {
  for (const rule of mcpDocumentRewrites()) {
    const matched = rule.has.every((item) => {
      const value = headers.get(item.key);
      if (!value) return false;
      if (!item.value) return true;
      return new RegExp(`^${item.value}$`).test(value);
    });
    if (matched) return rule.destination;
  }
  return null;
}
