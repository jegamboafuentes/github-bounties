import Link from "next/link";
import { getOptionalSession } from "@/auth";
import { AppHeader } from "@/components/header";
import { HomeAgent } from "@/components/home-agent";
import { HomeCompare } from "@/components/home-compare";
import { HomeHero } from "@/components/home-hero";
import { HomeStory } from "@/components/home-story";
import { HomeReveal } from "@/components/home-reveal";
import { HomeStats } from "@/components/home-stats";
import { NOT_LIGHTNING_BOUNTIES, loadHomepageStats } from "@/home";
import { resolveFundWalletRuntime } from "@/wallet/env";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [session, stats] = await Promise.all([getOptionalSession(), loadHomepageStats()]);
  const signedIn = Boolean(session?.user?.id);
  const fund = resolveFundWalletRuntime();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-12 px-6 py-14">
        <HomeReveal className="flex flex-col gap-12">
          <HomeHero signedIn={signedIn} chainName={fund.chainName} />
          <HomeStats source={stats} />
          <HomeCompare />
          <HomeStory chainName={fund.chainName} />
          <HomeAgent />
          <p className="home-footer-note home-reveal-item text-sm text-zinc-500">
          {NOT_LIGHTNING_BOUNTIES} Sign in with Google.{" "}
          <Link href="/about" className="underline underline-offset-4">
            About
          </Link>
          {" · "}
          <Link href="/developers" className="underline underline-offset-4">
            Developers
          </Link>
          {" · "}
          <Link href="/roadmap" className="underline underline-offset-4">
            Roadmap
          </Link>
          {" · "}
          <Link href="/board" className="underline underline-offset-4">
            Board
          </Link>
          {" · "}
          <Link href="/bounties/new" className="underline underline-offset-4">
            Post a bounty
          </Link>
          {" · "}
          <Link href="/signin" className="underline underline-offset-4">
            Sign in
          </Link>
          {" · "}
          <Link href="/settings" className="underline underline-offset-4">
            Settings
          </Link>
          . Exclusive claim-lock is retired; merge is still truth. Eligible winners
          claim their share to a BYO Base address. Pool members are paid to Settings
          wallets when settle runs. Escrow holds face in <code>gb-escrow</code>; 2% to{" "}
          <code>gb-fee</code> at settlement. Hosted checkout is disabled.
          </p>
        </HomeReveal>
      </main>
    </div>
  );
}
