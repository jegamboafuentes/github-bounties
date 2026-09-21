import { HOMEPAGE_DIFFERENTIATORS, NOT_LIGHTNING_BOUNTIES } from "@/home/differentiators";

export function HomeCompare() {
  return (
    <section id="compare" className="home-section-compare flex flex-col gap-4">
        <div className="home-section-heading home-reveal-item">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            vs Lightning Bounties
          </h2>
          <p className="mt-1 text-sm text-zinc-500">{NOT_LIGHTNING_BOUNTIES}</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {HOMEPAGE_DIFFERENTIATORS.map((item) => (
            <li
              key={item.id}
              className="home-diff-card home-reveal-item rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h3 className="font-medium">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{item.body}</p>
            </li>
          ))}
        </ul>
    </section>
  );
}
