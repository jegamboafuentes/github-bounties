import { renderSafeIssueHtml } from "@/bounties/markdown";

export function IssueBodyCard({ markdown }: { markdown: string | null }) {
  const html = markdown?.trim() ? renderSafeIssueHtml(markdown) : "";

  return (
    <section className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-10 h-32 w-40 rounded-full bg-emerald-400/10 blur-3xl dark:bg-emerald-400/10"
      />
      <div className="relative flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            GitHub issue
          </h2>
          <p className="mt-1 text-xs text-zinc-500">Full description from the linked issue.</p>
        </div>
        {html ? (
          <div className="issue-body text-sm leading-6 text-zinc-700 dark:text-zinc-300" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="text-sm text-zinc-500">No issue description on GitHub.</p>
        )}
      </div>
    </section>
  );
}
