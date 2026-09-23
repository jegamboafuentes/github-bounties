"use client";

import { useEffect, useRef, type ReactNode } from "react";

function select(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const EASE = "out(3)";

/**
 * Anime.js island. Content stays SSR; motion is a client enhancement.
 * Queries are scoped to this root. Respects prefers-reduced-motion
 * (`data-home-motion=reduced` skips animations). The story rail and
 * stage crossfade run only at ≥900px. They never hide the step text.
 */
export function HomeReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;

    if (prefersReducedMotion()) {
      el.dataset.homeMotion = "reduced";
      return;
    }

    let cancelled = false;
    let revert = () => {};

    void import("animejs").then(
      ({ animate, createScope, createTimeline, onScroll, stagger, utils }) => {
        if (cancelled || !root.current) return;
        const observers: { revert: () => unknown }[] = [];
        const scope = createScope({
          root,
          mediaQueries: {
            reduceMotion: "(prefers-reduced-motion: reduce)",
            storyPin: "(min-width: 900px)",
          },
        }).add((self) => {
          const host = root.current;
          if (!host) return;
          for (const observer of observers.splice(0, observers.length)) observer.revert();
          if (!self || self.matches.reduceMotion) {
            host.dataset.homeMotion = "reduced";
            for (const step of select(host, ".home-story-step")) delete step.dataset.active;
            return;
          }

          host.dataset.homeMotion = "ready";

          const kicker = select(host, ".home-hero-kicker");
          const wordmark = select(host, ".home-wordmark");
          const copy = select(host, ".home-hero-copy");
          const ctas = select(host, ".home-hero-ctas");
          const metrics = select(host, ".home-hero-metric");
          const heroTargets = [...kicker, ...wordmark, ...copy, ...ctas, ...metrics];
          if (heroTargets.length) {
            utils.set(heroTargets, { opacity: 0, y: 16 });
          }

          const hero = createTimeline({ defaults: { ease: EASE } });

          const aurora = select(host, ".home-aurora");
          if (aurora[0]) {
            utils.set(aurora, { opacity: 0.2 });
            hero.add(aurora[0], { opacity: [0.2, 0.62], duration: 1500, ease: "inOut(2)" }, 0);
            animate(aurora[0], {
              opacity: [0.5, 0.76],
              x: [0, 16],
              y: [0, -10],
              duration: 7800,
              ease: "inOut(2)",
              loop: true,
              alternate: true,
              delay: 1400,
            });
          }
          if (aurora[1]) {
            hero.add(aurora[1], { opacity: [0.12, 0.48], duration: 1700, ease: "inOut(2)" }, 80);
            animate(aurora[1], {
              opacity: [0.3, 0.58],
              x: [0, -12],
              y: [0, 8],
              duration: 9000,
              ease: "inOut(2)",
              loop: true,
              alternate: true,
              delay: 1600,
            });
          }

          if (kicker.length) {
            hero.add(kicker, { opacity: [0, 1], y: [14, 0], duration: 600 }, 40);
          }

          if (wordmark.length) {
            hero.add(
              wordmark,
              { opacity: [0, 1], y: [16, 0], scale: [0.97, 1], duration: 980, ease: "out(4)" },
              120,
            );
          }

          if (copy.length) {
            hero.add(copy, { opacity: [0, 1], y: [16, 0], duration: 700 }, 260);
          }

          if (ctas.length) {
            hero.add(ctas, { opacity: [0, 1], y: [14, 0], duration: 640 }, 380);
          }

          if (metrics.length) {
            hero.add(
              metrics,
              { opacity: [0, 1], y: [18, 0], duration: 680, delay: stagger(75) },
              500,
            );
          }

          const playOnEnter = (target: HTMLElement, items: HTMLElement[], step: number) => {
            if (!items.length) return;
            utils.set(items, { opacity: 0, y: 22 });
            let started = false;
            const motion = animate(items, {
              opacity: [0, 1],
              y: [22, 0],
              duration: 720,
              ease: EASE,
              delay: stagger(step),
              autoplay: false,
            });
            const play = () => {
              if (started) return;
              started = true;
              motion.play();
            };
            observers.push(
              onScroll({
                target,
                enter: "bottom-=72 top",
                repeat: false,
                onEnter: play,
              }),
            );
            const rect = target.getBoundingClientRect();
            if (rect.top < window.innerHeight - 48 && rect.bottom > 0) {
              play();
            }
          };

          const stats = select(host, ".home-section-stats")[0];
          if (stats) {
            playOnEnter(
              stats,
              [...select(stats, ".home-section-heading"), ...select(stats, ".home-stat-card")],
              80,
            );
          }

          const compare = select(host, ".home-section-compare")[0];
          if (compare) {
            playOnEnter(
              compare,
              [...select(compare, ".home-section-heading"), ...select(compare, ".home-diff-card")],
              90,
            );
          }

          const story = select(host, ".home-section-story")[0];
          if (story) {
            const steps = select(story, ".home-story-step");
            if (self.matches.storyPin) {
              const panels = select(story, ".home-story-panel");
              let current = -1;
              const activate = (index: number) => {
                if (index === current || index < 0 || index >= steps.length) return;
                current = index;
                steps.forEach((step, i) => {
                  if (i === index) step.dataset.active = "true";
                  else delete step.dataset.active;
                });
                panels.forEach((panel, i) => {
                  animate(panel, {
                    opacity: i === index ? 1 : 0,
                    duration: 380,
                    ease: EASE,
                    composition: "replace",
                  });
                });
              };

              utils.set(steps, { opacity: 1, y: 0 });
              panels.forEach((panel, i) => utils.set(panel, { opacity: i === 0 ? 1 : 0 }));

              const closestStep = () => {
                const mid = window.innerHeight / 2;
                let best = 0;
                let bestDist = Number.POSITIVE_INFINITY;
                steps.forEach((step, index) => {
                  const rect = step.getBoundingClientRect();
                  const dist = Math.abs(rect.top + rect.height / 2 - mid);
                  if (dist < bestDist) {
                    best = index;
                    bestDist = dist;
                  }
                });
                activate(best);
              };
              closestStep();

              const fill = select(story, ".home-story-rail-fill")[0];
              const stepsHost = select(story, ".home-story-steps")[0];
              if (stepsHost) {
                observers.push(
                  onScroll({
                    target: stepsHost,
                    enter: "bottom top",
                    leave: "top bottom",
                    onUpdate: closestStep,
                  }),
                );
              }
              if (fill && stepsHost) {
                utils.set(fill, { scaleY: 0 });
                animate(fill, {
                  scaleY: [0, 1],
                  ease: "linear",
                  autoplay: onScroll({
                    target: stepsHost,
                    enter: "bottom top",
                    leave: "top bottom",
                    sync: true,
                  }),
                });
              }
            } else {
              const items = [...select(story, ".home-section-heading"), ...steps];
              items.forEach((item, index) => {
                let started = false;
                const motion = animate(item, {
                  y: [12, 0],
                  duration: 640,
                  ease: EASE,
                  delay: index * 40,
                  autoplay: false,
                });
                const play = () => {
                  if (started) return;
                  started = true;
                  motion.play();
                };
                observers.push(
                  onScroll({
                    target: item,
                    enter: "bottom-=48 top",
                    repeat: false,
                    onEnter: play,
                  }),
                );
                const rect = item.getBoundingClientRect();
                if (rect.top < window.innerHeight - 24 && rect.bottom > 0) play();
              });
            }
          }

          const footer = select(host, ".home-footer-note")[0];
          if (footer) {
            playOnEnter(footer, [footer], 0);
          }

          host.dataset.homeMotion = "played";
        });
        revert = () => {
          for (const observer of observers) observer.revert();
          scope.revert();
        };
      },
    );

    return () => {
      cancelled = true;
      revert();
    };
  }, []);

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}
