"use client";

import { useState } from "react";
import type { McpConfigSnippet } from "@/mcp/client-config";

export function McpConfigPanel({ snippets }: { snippets: readonly McpConfigSnippet[] }) {
  const [tab, setTab] = useState(snippets[0]?.id ?? "cursor");
  const [copied, setCopied] = useState(false);
  const active = snippets.find((item) => item.id === tab) ?? snippets[0];
  if (!active) return null;

  async function copy() {
    const text = active.body;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-3 border-b border-zinc-200 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
        <div role="tablist" aria-label="MCP client config" className="flex flex-wrap gap-2">
          {snippets.map((item) => {
            const selected = item.id === active.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setTab(item.id);
                  setCopied(false);
                }}
                className={
                  selected
                    ? "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-800"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="px-4 pt-3 font-mono text-xs text-zinc-500">{active.filename}</p>
      <pre className="overflow-x-auto px-4 pb-4 pt-2 font-mono text-xs leading-5 text-zinc-800 dark:text-zinc-200">
        <code>{active.body}</code>
      </pre>
    </div>
  );
}
