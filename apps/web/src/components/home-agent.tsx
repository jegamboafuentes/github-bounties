import Link from "next/link";

export function HomeAgent() {
  return (
    <section id="agent" className="home-section-agent flex flex-col gap-4">
      <div className="home-section-heading home-reveal-item">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Use it from your AI agent
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          The public API and the MCP server let Cursor, Claude, and other agents read the board
          and act with your API key. Same rules as the website.
        </p>
      </div>
      <p className="home-agent-card home-reveal-item">
        <Link
          href="/developers"
          className="inline-flex items-center rounded-lg border border-zinc-300 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-50 dark:hover:bg-zinc-800"
        >
          Developers
        </Link>
      </p>
    </section>
  );
}
