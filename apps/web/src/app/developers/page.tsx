import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { AppHeader } from "@/components/header";
import { listRegisteredMcpTools } from "@/api/public/mcp-catalog";
import { apiMoneyEnabled, KEY_RATE_LIMITS, spendCeilings } from "@/api/access/policy";
import { PUBLIC_API_VERSION } from "@/api/public/version";
import { PRODUCT_NAME } from "@/lib/constants";
import { readPublicSiteOrigin } from "@/lib/site-env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Developers · ${PRODUCT_NAME}`,
  description:
    "GitHub Bounties public API (/api/v1) and MCP server (/mcp). Create an API key in Settings and connect Cursor or Claude.",
};

function windowPhrase(limit: number, windowMs: number): string {
  if (windowMs === 60_000) return `${limit} per minute`;
  if (windowMs === 3_600_000) return `${limit} per hour`;
  return `${limit} per ${Math.round(windowMs / 1000)} seconds`;
}

const CURSOR_ENV_HEADER = "Bearer ${env:GB_API_KEY}";

function mcpClientConfig(mcpUrl: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "github-bounties": {
          url: mcpUrl,
          headers: {
            Authorization: "Bearer YOUR_API_KEY",
          },
        },
      },
    },
    null,
    2,
  );
}

export default async function DevelopersPage() {
  const requestHeaders = await headers();
  const origin = readPublicSiteOrigin(process.env, {
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    proto: requestHeaders.get("x-forwarded-proto"),
  });
  const mcpUrl = `${origin}/mcp`;
  const config = mcpClientConfig(mcpUrl);
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
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Developers</h1>
          <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
            The public API at <code>/api/v1</code> is the HTTP surface for the board, one bounty,
            funders, cached intelligence, platform stats, and the calls that need an API key.
            Interactive docs are at{" "}
            <Link href="/api/docs" className="underline underline-offset-4">
              /api/docs
            </Link>
            . The OpenAPI document is{" "}
            <Link href="/api/v1/openapi.json" className="underline underline-offset-4">
              /api/v1/openapi.json
            </Link>
            .
          </p>
          <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
            The MCP server at <code>/mcp</code> is stateless streamable HTTP. It exposes the same
            tools an agent calls from Cursor or Claude. Send{" "}
            <code>Authorization: Bearer</code> and an API key. Cookies are ignored. Anonymous
            callers can list every tool and can read the public board.
          </p>
        </header>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            MCP config
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Replace <code>YOUR_API_KEY</code> with a key from Settings. Both files point at{" "}
            <code>{mcpUrl}</code>. Cursor can use <code>{CURSOR_ENV_HEADER}</code> in place of
            the pasted key.
          </p>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Cursor · .cursor/mcp.json</h3>
            <pre className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-4 font-mono text-xs leading-5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              <code>{config}</code>
            </pre>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Claude Desktop · claude_desktop_config.json</h3>
            <pre className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-4 font-mono text-xs leading-5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              <code>{config}</code>
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">API keys</h2>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Create a key in{" "}
            <Link href="/settings" className="underline underline-offset-4">
              Settings
            </Link>
            . Keys belong to the signed-in human (the Google account). There are no agent-owned
            accounts. The plaintext is shown once.
          </p>
          <ul className="flex max-w-2xl flex-col gap-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            <li>
              <span className="font-medium text-zinc-950 dark:text-zinc-50">read</span> — authenticated
              reads for the key owner: profile, usage, their bounties and claims, notification
              preferences, and linked accounts. Public board reads do not need a key.
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
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Tools · {tools.length}
          </h2>
          <p className="text-sm text-zinc-500">
            Public API version <code>{PUBLIC_API_VERSION}</code>. Listed from the MCP tool registry.
          </p>
          <ul className="flex flex-col gap-3">
            {tools.map((tool) => (
              <li
                key={tool.name}
                className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <h3 className="font-mono text-sm font-medium">{tool.name}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                  {tool.description}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Rate limits
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Authenticated reads are {readLimit}. Authenticated writes are {writeLimit}. Those
            counters are stored per key.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Money actions
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {moneyOn
              ? `Money actions over the API and MCP are enabled on this environment. Configured caps are ${caps.perTxUsdc} USDC per transaction and ${caps.dailyUsdc} USDC per UTC day.`
              : "Money actions over the API and MCP are disabled on this environment."}
          </p>
        </section>
      </main>
      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <nav
          aria-label="Developers"
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
