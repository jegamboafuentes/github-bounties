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
 * (`data-home-motion=reduced` skips animations).
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
          },
        }).add((self) => {
          const host = root.current;
          if (!host) return;
          if (!self || self.matches.reduceMotion) {
            host.dataset.homeMotion = "reduced";
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

          const roadmap = select(host, ".home-section-roadmap")[0];
          if (roadmap) {
            playOnEnter(
              roadmap,
              [
                ...select(roadmap, ".home-section-heading"),
                ...select(roadmap, ".home-roadmap-item"),
              ],
              55,
            );
          }

          const modules = select(host, ".home-section-modules")[0];
          if (modules) {
            playOnEnter(
              modules,
              [
                ...select(modules, ".home-section-heading"),
                ...select(modules, ".home-module-row"),
              ],
              45,
            );
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
