import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AppHeader } from "@/components/header";
import { BrandWordmark } from "@/components/brand-wordmark";
import { TeamSocialLinks } from "@/components/team-social-links";
import {
  ABOUT_BIOS_NOTE,
  ABOUT_CHAPTER,
  ABOUT_COFOUNDERS,
  ABOUT_CONTINUES,
  ABOUT_DISTINCTION,
  ABOUT_LINKS,
  ABOUT_ROADMAP_CTA,
} from "@/home/about";
import { PRODUCT_NAME } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `About · ${PRODUCT_NAME}`,
  description:
    "GitHub Bounties is the next chapter of Lightning Bounties — the same cofounders, paying merged GitHub work in USDC on Base.",
};

function OriginLink({
  href,
  label,
  kind,
}: {
  href: string;
  label: string;
  kind: "primary" | "secondary";
}) {
  const className =
    kind === "primary"
      ? "inline-flex items-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      : "inline-flex items-center rounded-lg border border-zinc-300 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-50 dark:hover:bg-zinc-800";

  return (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export default function AboutPage() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-12 px-6 py-14">
        <header className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute -left-1/4 -top-16 h-56 w-2/3 rounded-full bg-emerald-400/20 blur-3xl dark:bg-emerald-400/15"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(to_bottom,transparent,transparent_3px,rgb(0_0_0/0.035)_3px,rgb(0_0_0/0.035)_4px)] dark:bg-[repeating-linear-gradient(to_bottom,transparent,transparent_3px,rgb(255_255_255/0.035)_3px,rgb(255_255_255/0.035)_4px)]"
          />
          <div className="relative flex flex-col gap-5">
            <div aria-hidden="true">
              <BrandWordmark size="splash" priority />
            </div>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              Lightning Bounties, continued
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">About {PRODUCT_NAME}</h1>
            <p className="max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">{ABOUT_CHAPTER}</p>
            <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">{ABOUT_CONTINUES}</p>
            <p className="max-w-2xl text-sm leading-6 text-zinc-500">{ABOUT_DISTINCTION}</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <OriginLink href={ABOUT_LINKS.mit.href} label={ABOUT_LINKS.mit.label} kind="primary" />
              <OriginLink
                href={ABOUT_LINKS.mitStory.href}
                label={ABOUT_LINKS.mitStory.label}
                kind="secondary"
              />
              <OriginLink
                href={ABOUT_LINKS.original.href}
                label={ABOUT_LINKS.original.label}
                kind="secondary"
              />
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              <li className="rounded-xl border border-zinc-200 bg-white/80 p-4 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400">
                {ABOUT_LINKS.mit.detail}
              </li>
              <li className="rounded-xl border border-zinc-200 bg-white/80 p-4 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400">
                {ABOUT_LINKS.mitStory.detail}
              </li>
              <li className="rounded-xl border border-zinc-200 bg-white/80 p-4 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400 sm:col-span-2">
                {ABOUT_LINKS.original.detail}
              </li>
            </ul>
          </div>
        </header>

        <section aria-labelledby="cofounders-heading" className="flex flex-col gap-4">
          <div>
            <h2
              id="cofounders-heading"
              className="text-sm font-semibold uppercase tracking-wide text-zinc-500"
            >
              Cofounders
            </h2>
            <p className="mt-1 text-sm text-zinc-500">{ABOUT_BIOS_NOTE}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {ABOUT_COFOUNDERS.map((person) => (
              <li
                key={person.name}
                className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start gap-3">
                  <Image
                    src={person.photo}
                    alt={person.photoAlt}
                    width={391}
                    height={292}
                    className="h-20 w-[6.75rem] shrink-0 rounded-lg bg-zinc-100 object-contain dark:bg-zinc-800"
                  />
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold tracking-tight">{person.name}</h3>
                    <TeamSocialLinks person={person} />
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{person.bio}</p>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="roadmap-cta-heading"
          className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="max-w-xl">
            <h2
              id="roadmap-cta-heading"
              className="text-sm font-semibold uppercase tracking-wide text-zinc-500"
            >
              {ABOUT_ROADMAP_CTA.heading}
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {ABOUT_ROADMAP_CTA.body}
            </p>
          </div>
          <Link
            href={ABOUT_ROADMAP_CTA.href}
            className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {ABOUT_ROADMAP_CTA.label}
          </Link>
        </section>
      </main>
      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <nav
          aria-label="About"
          className="mx-auto flex w-full max-w-4xl flex-wrap gap-x-4 gap-y-2 px-6 py-6 text-sm text-zinc-600 dark:text-zinc-400"
        >
          <Link href="/" className="underline-offset-4 hover:underline">
            Home
          </Link>
          <Link href="/roadmap" className="underline-offset-4 hover:underline">
            Roadmap
          </Link>
          <Link href="/developers" className="underline-offset-4 hover:underline">
            Developers
          </Link>
          <Link href="/board" className="underline-offset-4 hover:underline">
            Board
          </Link>
          <a
            href={ABOUT_LINKS.mit.href}
            className="underline-offset-4 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            MIT genesis / win
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <a
            href={ABOUT_LINKS.mitStory.href}
            className="underline-offset-4 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Medium story
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <a
            href={ABOUT_LINKS.original.href}
            className="underline-offset-4 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Original product
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </nav>
      </footer>
    </div>
  );
}
