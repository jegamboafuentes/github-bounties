import Link from "next/link";
import { homepageStatCards } from "@/home/stats-display";
import type { HomepageStatsSource } from "@/home/load-stats";

export function HomeStats({ source }: { source: HomepageStatsSource }) {
  const cards = homepageStatCards(source.stats);

  return (
    <section id="stats" className="home-section-stats flex flex-col gap-4">
        <div className="home-section-heading home-reveal-item flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Live platform stats
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {source.live
                ? "From this environment via getPlatformStats (same as GET /api/stats)."
                : "Live stats unavailable here — showing empty-database zeros."}
            </p>
          </div>
          <p className="text-xs text-zinc-500">
            <Link href="/api/stats" prefetch={false} className="underline underline-offset-4">
              GET /api/stats
            </Link>
            <span className="mx-1">·</span>
            <span title={source.stats.generatedAt}>schema v{source.stats.schemaVersion}</span>
          </p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <div
              key={card.key}
              className={
                card.key === "volumeUsdc.transacted"
                  ? "home-stat-card home-reveal-item rounded-xl border border-emerald-200/80 bg-white p-4 dark:border-emerald-900/80 dark:bg-zinc-900 sm:col-span-2"
                  : "home-stat-card home-reveal-item rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              }
            >
              <dt className="text-xs uppercase tracking-wide text-zinc-500">{card.label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{card.value}</dd>
              <dd className="mt-1 text-xs leading-5 text-zinc-500">{card.hint}</dd>
            </div>
          ))}
        </dl>
    </section>
  );
}
