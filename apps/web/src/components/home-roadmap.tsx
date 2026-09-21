import {
  PUBLIC_ROADMAP,
  ROADMAP_STATUS_LABEL,
  roadmapFocus,
  type RoadmapStatus,
} from "@/home/roadmap";
import { HomeRoadmapMotion } from "@/components/home-roadmap-motion";

function statusClass(status: RoadmapStatus): string {
  if (status === "shipped") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  }
  if (status === "in_progress") {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  }
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

function nodeClass(status: RoadmapStatus, active: boolean): string {
  if (active) {
    return "border-amber-400 bg-amber-300 shadow-[0_0_0_4px_rgb(251_191_36/0.22)] dark:border-amber-300 dark:bg-amber-400";
  }
  if (status === "shipped") {
    return "border-emerald-500 bg-emerald-400 dark:border-emerald-400 dark:bg-emerald-500";
  }
  if (status === "in_progress") {
    return "border-amber-400 bg-amber-300 dark:border-amber-300 dark:bg-amber-400";
  }
  return "border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950";
}

function phaseClass(status: RoadmapStatus, active: boolean): string {
  if (active) {
    return "border-amber-300/80 bg-white shadow-sm dark:border-amber-800 dark:bg-zinc-900";
  }
  if (status === "planned") {
    return "border-zinc-200 bg-white/80 dark:border-zinc-800 dark:bg-zinc-900/70";
  }
  return "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
}

export function HomeRoadmap() {
  const focus = roadmapFocus();

  return (
    <HomeRoadmapMotion progress={focus.railProgress}>
      <section id="roadmap" className="flex flex-col gap-5">
        <div className="roadmap-heading">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Public roadmap
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            What is live, and what is next. No invented ship dates.
          </p>
        </div>
        <ol className="relative space-y-3 pl-8">
          <div
            className="roadmap-rail pointer-events-none absolute bottom-3 left-[11px] top-3 w-0.5"
            aria-hidden
          >
            <span className="roadmap-rail-base absolute inset-0 rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <span className="roadmap-rail-progress absolute inset-0 origin-top rounded-full bg-gradient-to-b from-emerald-500 via-emerald-400 to-amber-400 dark:from-emerald-400 dark:via-emerald-300 dark:to-amber-300" />
          </div>
          {PUBLIC_ROADMAP.map((item) => {
            const active = item.id === focus.activeId;
            return (
              <li key={item.id} className="relative">
                <span
                  aria-hidden
                  className={`roadmap-node absolute -left-[25px] top-5 h-2.5 w-2.5 rounded-full border-2 ${nodeClass(item.status, active)}`}
                />
                <article
                  className={`roadmap-phase rounded-xl border p-4 ${phaseClass(item.status, active)}`}
                  data-roadmap-active={active ? "true" : "false"}
                  aria-current={active ? "step" : undefined}
                >
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
                </article>
              </li>
            );
          })}
        </ol>
      </section>
    </HomeRoadmapMotion>
  );
}
