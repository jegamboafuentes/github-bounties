import Link from "next/link";
import { BrandWordmark } from "@/components/brand-wordmark";
import { HomeReveal } from "@/components/home-reveal";
import { homepageCtas, type HomepageCtaKind } from "@/home/ctas";
import { DEFAULT_CURRENCY, FEE_BPS, PRODUCT_NAME } from "@/lib/constants";
import { fundRailCaption, type FundChainDisplayName } from "@/bounties/display";

function ctaClass(kind: HomepageCtaKind): string {
  if (kind === "primary") {
    return "inline-flex items-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white";
  }
  if (kind === "secondary") {
    return "inline-flex items-center rounded-lg border border-zinc-300 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-50 dark:hover:bg-zinc-800";
  }
  return "inline-flex items-center px-1 py-2 text-sm font-medium text-zinc-600 underline underline-offset-4 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50";
}

export function HomeHero({
  signedIn,
  chainName,
}: {
  signedIn: boolean;
  chainName: FundChainDisplayName;
}) {
  const ctas = homepageCtas(signedIn);

  return (
    <HomeReveal className="relative overflow-hidden">
      <div
        aria-hidden
        className="home-aurora pointer-events-none absolute -left-1/4 -top-16 h-72 w-2/3 rounded-full bg-emerald-400/20 blur-3xl dark:bg-emerald-400/15"
      />
      <div
        aria-hidden
        className="home-aurora pointer-events-none absolute -right-1/5 top-8 h-56 w-1/2 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-300/10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(to_bottom,transparent,transparent_3px,rgb(0_0_0/0.035)_3px,rgb(0_0_0/0.035)_4px)] dark:bg-[repeating-linear-gradient(to_bottom,transparent,transparent_3px,rgb(255_255_255/0.035)_3px,rgb(255_255_255/0.035)_4px)]"
      />
      <div className="relative flex flex-col gap-5">
        <p className="home-reveal-item text-sm font-medium text-emerald-700 dark:text-emerald-400">
          V2-4 parallel hunt
        </p>
        <h1 className="home-reveal-item home-wordmark">
          <BrandWordmark size="hero" priority />
          <span className="sr-only">{PRODUCT_NAME}</span>
        </h1>
        <p className="home-reveal-item max-w-xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          USDC bounties on GitHub issues. Winner is the author of the merged pull
          request that closes funded issue #N. Parallel hunt; merge is truth.
        </p>
        <div className="home-reveal-item flex flex-wrap items-center gap-3">
          {ctas.map((cta) => (
            <Link key={cta.href} href={cta.href} className={ctaClass(cta.kind)}>
              {cta.label}
            </Link>
          ))}
        </div>
        <dl className="home-reveal-item grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-zinc-200 bg-white/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/80">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Fee</dt>
            <dd className="mt-1 text-2xl font-semibold">{FEE_BPS / 100}%</dd>
            <dd className="text-sm text-zinc-500">fee_bps = {FEE_BPS}</dd>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/80">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Hunt</dt>
            <dd className="mt-1 text-2xl font-semibold">Parallel</dd>
            <dd className="text-sm text-zinc-500">optional Working on this, not exclusive</dd>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/80">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Rail</dt>
            <dd className="mt-1 text-2xl font-semibold">{DEFAULT_CURRENCY}</dd>
            <dd className="text-sm text-zinc-500">{fundRailCaption(chainName)}</dd>
          </div>
        </dl>
      </div>
    </HomeReveal>
  );
}
