import { PUBLIC_ROADMAP, ROADMAP_STATUS_LABEL, type RoadmapStatus } from "@/home/roadmap";

function statusClass(status: RoadmapStatus): string {
  if (status === "shipped") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  }
  if (status === "in_progress") {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  }
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

export function HomeRoadmap() {
  return (
    <section id="roadmap" className="home-section-roadmap flex flex-col gap-4">
        <div className="home-section-heading home-reveal-item">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Public roadmap
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Upcoming versions, marked honestly. No invented ship dates. Editable in{" "}
            <code>docs/roadmap.md</code>.
          </p>
        </div>
        <ol className="relative space-y-3 border-l border-zinc-200 pl-5 dark:border-zinc-800">
          {PUBLIC_ROADMAP.map((item) => (
            <li key={item.id} className="home-roadmap-item home-reveal-item relative">
              <span
                aria-hidden
                className="absolute -left-[25px] top-5 h-2.5 w-2.5 rounded-full border border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950"
              />
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {item.version}
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(item.status)}`}
                  >
                    {ROADMAP_STATUS_LABEL[item.status]}
                  </span>
                </div>
                <h3 className="mt-1 font-medium">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                  {item.summary}
                </p>
              </div>
            </li>
          ))}
        </ol>
    </section>
  );
}
