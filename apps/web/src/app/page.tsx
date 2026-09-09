import Link from "next/link";
import {
  CLAIM_LOCK_HOURS,
  DEFAULT_CHAIN,
  DEFAULT_CURRENCY,
  FEE_BPS,
  PRODUCT_NAME,
} from "@/lib/constants";
import {
  authModule,
  bountiesModule,
  claimsModule,
  escrowModule,
  webhooksModule,
} from "@/modules";
import { AppHeader } from "@/components/header";

const modules = [
  authModule,
  bountiesModule,
  escrowModule,
  webhooksModule,
  claimsModule,
];

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-14">
        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            V1-4 bounty board
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">{PRODUCT_NAME}</h1>
          <p className="max-w-xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            USDC bounties on GitHub issues. Winner is the author of the merged pull
            request that closes funded issue #N. Claim-lock coordinates work; merge
            is truth.
          </p>
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Fee</dt>
            <dd className="mt-1 text-2xl font-semibold">{FEE_BPS / 100}%</dd>
            <dd className="text-sm text-zinc-500">fee_bps = {FEE_BPS}</dd>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">
              Claim-lock
            </dt>
            <dd className="mt-1 text-2xl font-semibold">{CLAIM_LOCK_HOURS}h</dd>
            <dd className="text-sm text-zinc-500">exclusive, no USDC movement</dd>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Rail</dt>
            <dd className="mt-1 text-2xl font-semibold">{DEFAULT_CURRENCY}</dd>
            <dd className="text-sm text-zinc-500">chain {DEFAULT_CHAIN} (schema)</dd>
          </div>
        </dl>
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Modules
          </h2>
          <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {modules.map((mod) => (
              <li key={mod.name} className="flex items-start justify-between gap-4 px-4 py-3">
                <div>
                  <p className="font-medium capitalize">{mod.name}</p>
                  <p className="text-sm text-zinc-500">{mod.notes}</p>
                </div>
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {mod.wired ? "wired" : mod.nextTicket}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-sm text-zinc-500">
          This is not Lightning Bounties, LB1, or “Lightning Bounties 2”. Sign in with
          Google.{" "}
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
          . Claim-lock is coordination only; merge is still truth. CDP / x402 live
          calls are V1-5.
        </p>
      </main>
    </div>
  );
}
