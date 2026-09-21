import type { IntelligenceView } from "@/intelligence/load";
import { intelligenceUnavailableCopy } from "@/intelligence/errors";

const COMPLEXITY_HINT: Record<"S" | "M" | "L", string> = {
  S: "Small — limited scope",
  M: "Medium — a typical change",
  L: "Large — broader or trickier",
};

export function BountyIntelligenceCard({ intelligence }: { intelligence: IntelligenceView }) {
  const unavailable =
    intelligence.status === "unavailable"
      ? intelligenceUnavailableCopy(intelligence)
      : null;

  return (
    <section className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-12 top-0 h-28 w-36 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-300/10"
      />
      <div className="relative flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Bounty intelligence
            </h2>
            <p className="mt-1 text-xs text-zinc-500">{intelligence.estimateLabel}</p>
          </div>
        </div>

        {unavailable ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            <p>{unavailable.headline}</p>
            <p className="mt-1 font-mono text-xs text-zinc-500">{unavailable.detail}</p>
          </div>
        ) : intelligence.status === "ready" ? (
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-white/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/40 sm:col-span-3">
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Repo about</dt>
              <dd className="mt-1 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                {intelligence.repoAbout}
              </dd>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Language / stack</dt>
              <dd className="mt-1 text-lg font-semibold">{intelligence.languageStack}</dd>
            </div>
            <div className="rounded-xl border border-emerald-200/80 bg-white/80 p-4 dark:border-emerald-900/80 dark:bg-zinc-950/40 sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Complexity</dt>
              <dd className="mt-1 text-2xl font-semibold">{intelligence.complexity}</dd>
              <dd className="mt-1 text-xs leading-5 text-zinc-500">
                {COMPLEXITY_HINT[intelligence.complexity]} · {intelligence.estimateLabel}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
    </section>
  );
}
