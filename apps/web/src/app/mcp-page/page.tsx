import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/header";
import { McpConfigPanel } from "@/components/mcp-config-panel";
import { listRegisteredMcpTools } from "@/api/public/mcp-catalog";
import { MONEY_ACTIONS_DISABLED } from "@/api/access/money-wording";
import { apiMoneyEnabled, KEY_RATE_LIMITS, spendCeilings } from "@/api/access/policy";
import { PUBLIC_API_VERSION } from "@/api/public/version";
import { PRODUCT_NAME } from "@/lib/constants";
import { spendCapsLabel } from "@/mcp/caps";
import { mcpConfigSnippets, mcpEndpointUrl } from "@/mcp/client-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `MCP · ${PRODUCT_NAME}`,
  description:
    "Connect Cursor, Claude, or any MCP client to GitHub Bounties. Copy a config, create an API key, and ask your agent.",
  alternates: { canonical: "/mcp" },
};

function windowPhrase(limit: number, windowMs: number): string {
  if (windowMs === 60_000) return `${limit} per minute`;
  if (windowMs === 3_600_000) return `${limit} per hour`;
  return `${limit} per ${Math.round(windowMs / 1000)} seconds`;
}

const STEPS = [
  {
    title: "Create an API key in Settings",
    body: "Open Settings and create a key. The plaintext is shown once. Keys belong to your Google account.",
  },
  {
    title: "Paste the config",
    body: "Copy the snippet for Cursor, Claude Desktop, or a generic MCP client and paste it into that app.",
  },
  {
    title: "Ask your agent",
    body: "Ask it to list bounties, read one, or take an action your key allows. It calls the tools on this server.",
  },
] as const;

const SCOPE_LABEL = {
  public: "public",
  read: "read",
  write: "write",
  money: "money",
} as const;

export default async function McpPage() {
  const mcpUrl = mcpEndpointUrl(process.env);
  const snippets = mcpConfigSnippets(process.env);
  const tools = await listRegisteredMcpTools();
  const moneyOn = apiMoneyEnabled();
  const caps = spendCeilings();
  const readLimit = windowPhrase(KEY_RATE_LIMITS.read.limit, KEY_RATE_LIMITS.read.windowMs);
  const writeLimit = windowPhrase(KEY_RATE_LIMITS.write.limit, KEY_RATE_LIMITS.write.windowMs);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-12 px-6 py-14">
        <header className="flex flex-col gap-3">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            Public API {PUBLIC_API_VERSION}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">MCP</h1>
          <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
            Connect Cursor, Claude, or any MCP client. The server is stateless HTTP at{" "}
            <code>{mcpUrl}</code>. Send <code>Authorization: Bearer</code> and an API key. Cookies
            are ignored. Anonymous callers can list every tool and read the public board.
          </p>
        </header>

        <section className="flex flex-col gap-3" aria-labelledby="mcp-config-heading">
          <h2 id="mcp-config-heading" className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Config
          </h2>
          <McpConfigPanel snippets={snippets} />
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            The snippets use a placeholder, not a live key. Cursor can keep{" "}
            <code>{"Bearer ${env:GB_API_KEY}"}</code> and read <code>GB_API_KEY</code> from the
            environment. Other clients replace <code>YOUR_API_KEY</code>.
          </p>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="mcp-how-heading">
          <h2 id="mcp-how-heading" className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Why / How
          </h2>
          <ol className="grid gap-3 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-2 text-sm font-medium">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                  {index === 0 ? (
                    <>
                      Open{" "}
                      <Link href="/settings" className="underline underline-offset-4">
                        Settings
                      </Link>{" "}
                      and create a key. The plaintext is shown once. Keys belong to your Google
                      account.
                    </>
                  ) : (
                    step.body
                  )}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="mcp-tools-heading">
          <h2 id="mcp-tools-heading" className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Tools · {tools.length}
          </h2>
          <p className="text-sm text-zinc-500">
            Listed from the MCP tool registry. Public API version <code>{PUBLIC_API_VERSION}</code>.
          </p>
          <ul className="flex flex-col gap-3">
            {tools.map((tool) => (
              <li
                key={tool.name}
                className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-mono text-sm font-medium">{tool.name}</h3>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {SCOPE_LABEL[tool.scope]}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{tool.summary}</p>
                {tool.description.includes(MONEY_ACTIONS_DISABLED) ? (
                  <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                    {MONEY_ACTIONS_DISABLED}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">API keys</h2>
          <ul className="flex max-w-2xl flex-col gap-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            <li>
              <span className="font-medium text-zinc-950 dark:text-zinc-50">read</span> — profile,
              usage, your bounties and claims, notification preferences, and linked accounts. Public
              board reads do not need a key.
            </li>
            <li>
              <span className="font-medium text-zinc-950 dark:text-zinc-50">write</span> — create a
              bounty, signal working, clear that signal, cancel an unfunded bounty, and update the
              profile or notification preferences.
            </li>
            <li>
              <span className="font-medium text-zinc-950 dark:text-zinc-50">money</span> — fund, top
              up, claim a winner share, claim a pool share, and refund. A key with this scope needs
              a saved payout wallet and a linked GitHub account.
            </li>
          </ul>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Interactive HTTP docs are at{" "}
            <Link href="/api/docs" className="underline underline-offset-4">
              /api/docs
            </Link>
            . The OpenAPI document is{" "}
            <Link href="/api/v1/openapi.json" className="underline underline-offset-4">
              /api/v1/openapi.json
            </Link>
            .
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Rate limits</h2>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Authenticated reads are {readLimit}. Authenticated writes are {writeLimit}. Those
            counters are stored per key.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Money actions</h2>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {moneyOn
              ? `Money actions over the API and MCP are enabled on this environment. Configured caps are ${spendCapsLabel(caps.perTxUsdc, caps.dailyUsdc)}.`
              : MONEY_ACTIONS_DISABLED}
          </p>
        </section>
      </main>
      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <nav
          aria-label="MCP"
          className="mx-auto flex w-full max-w-4xl flex-wrap gap-x-4 gap-y-2 px-6 py-6 text-sm text-zinc-600 dark:text-zinc-400"
        >
          <Link href="/" className="underline-offset-4 hover:underline">
            Home
          </Link>
          <Link href="/about" className="underline-offset-4 hover:underline">
            About
          </Link>
          <Link href="/roadmap" className="underline-offset-4 hover:underline">
            Roadmap
          </Link>
          <Link href="/board" className="underline-offset-4 hover:underline">
            Board
          </Link>
        </nav>
      </footer>
    </div>
  );
}
