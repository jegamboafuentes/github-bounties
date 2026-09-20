import { HomeReveal } from "@/components/home-reveal";
import {
  authModule,
  bountiesModule,
  claimsModule,
  escrowModule,
  webhooksModule,
} from "@/modules";

const modules = [authModule, bountiesModule, escrowModule, webhooksModule, claimsModule];

export function HomeModules() {
  return (
    <HomeReveal>
      <section className="home-reveal-item flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Modules</h2>
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {modules.map((mod) => (
            <li key={mod.name} className="flex items-start justify-between gap-4 px-4 py-3">
              <div>
                <p className="font-medium capitalize">{mod.name}</p>
                <p className="text-sm text-zinc-500">{mod.notes}</p>
              </div>
              <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {mod.wired ? "wired" : mod.nextTicket}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </HomeReveal>
  );
}
