"use client";

import { useEffect, useRef, type ReactNode } from "react";

function select(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

/**
 * Anime.js island. Content stays SSR; motion is a client enhancement.
 * Queries are scoped to this root. Respects prefers-reduced-motion.
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

    let cancelled = false;
    let revert = () => {};

    void import("animejs").then(({ animate, createScope, stagger }) => {
      if (cancelled || !root.current) return;
      const scope = createScope({
        root,
        mediaQueries: {
          reduceMotion: "(prefers-reduced-motion: reduce)",
        },
      }).add((self) => {
        if (!self || self.matches.reduceMotion) return;
        const host = root.current;
        if (!host) return;
        const items = select(host, ".home-reveal-item");
        if (items.length) {
          animate(items, {
            opacity: { from: 0, to: 1, duration: 700, ease: "out(3)" },
            y: { from: 20, to: 0, duration: 800, ease: "out(4)" },
            delay: stagger(90),
          });
        }
        const wordmark = select(host, ".home-wordmark");
        if (wordmark.length) {
          animate(wordmark, {
            scale: { from: 0.96, to: 1, duration: 1000, ease: "out(3)" },
          });
        }
        const aurora = select(host, ".home-aurora");
        if (aurora.length) {
          animate(aurora, {
            opacity: { from: 0.35, to: 0.75, ease: "inOut(2)", duration: 4200 },
            loop: true,
            alternate: true,
          });
        }
      });
      revert = () => scope.revert();
    });

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
