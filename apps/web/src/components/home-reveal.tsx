"use client";

import { useEffect, useRef, type ReactNode } from "react";

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
    if (!root.current) return;

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
        animate(".home-reveal-item", {
          opacity: { from: 0, to: 1, duration: 650, ease: "out(3)" },
          y: { from: 16, to: 0, duration: 750, ease: "out(4)" },
          delay: stagger(70),
        });
        animate(".home-wordmark", {
          scale: { from: 0.97, to: 1, duration: 900, ease: "out(3)" },
        });
        animate(".home-aurora", {
          opacity: { from: 0.35, to: 0.72, ease: "inOut(2)", duration: 4200 },
          loop: true,
          alternate: true,
        });
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
