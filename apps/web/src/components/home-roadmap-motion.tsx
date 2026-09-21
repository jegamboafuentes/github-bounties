"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

function select(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

/**
 * Roadmap-only motion island. SSR stays on; Anime.js is a client enhancement.
 * Plays once when the section enters view. Respects prefers-reduced-motion.
 */
export function HomeRoadmapMotion({
  children,
  progress,
}: {
  children: ReactNode;
  progress: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const fill = clampProgress(progress);

  useEffect(() => {
    const host = root.current;
    if (!host) return;

    let cancelled = false;
    let revert = () => {};
    let io: IntersectionObserver | undefined;
    let fallback = 0;

    const settle = (state: "played" | "reduced") => {
      if (root.current) root.current.dataset.roadmapMotion = state;
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      settle("reduced");
      return;
    }

    host.dataset.roadmapMotion = "pending";
    fallback = window.setTimeout(() => {
      if (root.current?.dataset.roadmapMotion === "pending") settle("reduced");
    }, 2400);

    const play = () => {
      void import("animejs")
        .then(({ animate, createScope, stagger }) => {
          if (cancelled || !root.current) return;
          const scope = createScope({ root }).add(() => {
            const el = root.current;
            if (!el) return;
            const railFill = Number(el.dataset.roadmapProgress ?? "1");

            const heading = select(el, ".roadmap-heading");
            if (heading.length) {
              animate(heading, {
                opacity: [0, 1],
                y: [10, 0],
                duration: 480,
                ease: "out(5)",
              });
            }

            const rail = select(el, ".roadmap-rail-progress");
            if (rail.length) {
              animate(rail, {
                scaleY: [0, railFill],
                duration: 980,
                ease: "inOut(3)",
              });
            }

            const nodes = select(el, ".roadmap-node");
            if (nodes.length) {
              animate(nodes, {
                scale: [0.4, 1],
                opacity: [0, 1],
                duration: 420,
                ease: "out(4)",
                delay: stagger(90, { start: 140 }),
              });
            }

            const phases = select(el, ".roadmap-phase");
            if (phases.length) {
              animate(phases, {
                opacity: [0, 1],
                x: [20, 0],
                y: [16, 0],
                duration: 620,
                ease: "out(5)",
                delay: stagger(105, { start: 90 }),
                onComplete: () => settle("played"),
              });
            } else {
              settle("played");
            }
          });
          revert = () => scope.revert();
        })
        .catch(() => settle("reduced"));
    };

    io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          play();
          io?.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(host);

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      io?.disconnect();
      revert();
    };
  }, []);

  return (
    <div
      ref={root}
      className="roadmap-motion"
      data-roadmap-progress={String(fill)}
      style={{ "--roadmap-progress": String(fill) } as CSSProperties}
    >
      {children}
    </div>
  );
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
