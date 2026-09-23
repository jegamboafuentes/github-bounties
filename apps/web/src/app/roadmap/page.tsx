import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/header";
import { PublicRoadmap } from "@/components/public-roadmap";
import { ROADMAP_INTRO } from "@/home/roadmap";
import { PRODUCT_NAME } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Roadmap · ${PRODUCT_NAME}`,
  description: ROADMAP_INTRO,
};

export default function RoadmapPage() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-14">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Public roadmap</h1>
          <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
            {ROADMAP_INTRO} Editable in <code>docs/roadmap.md</code>.
          </p>
        </header>
        <PublicRoadmap />
      </main>
      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <nav
          aria-label="Roadmap"
          className="mx-auto flex w-full max-w-4xl flex-wrap gap-x-4 gap-y-2 px-6 py-6 text-sm text-zinc-600 dark:text-zinc-400"
        >
          <Link href="/" className="underline-offset-4 hover:underline">
            Home
          </Link>
          <Link href="/about" className="underline-offset-4 hover:underline">
            About
          </Link>
          <Link href="/board" className="underline-offset-4 hover:underline">
            Board
          </Link>
        </nav>
      </footer>
    </div>
  );
}
