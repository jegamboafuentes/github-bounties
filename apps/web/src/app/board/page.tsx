import Link from "next/link";
import { AppHeader } from "@/components/header";
import { BountyCard } from "@/components/bounty-card";
import { listBoardBounties, LOCK_NOT_MONEY_COPY } from "@/bounties";
import { bountyStatusValues } from "@/db/schema";
import { getRuntimeDb } from "@/db/runtime";
import { CLAIM_LOCK_HOURS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string; status?: string }>;
}) {
  const params = await searchParams;
  const repo = params.repo ?? "";
  const status = params.status ?? "all";
  let bounties: Awaited<ReturnType<typeof listBoardBounties>> = [];
  let loadError: string | null = null;
  try {
    bounties = await listBoardBounties(getRuntimeDb(), { repo, status });
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Could not load the board.";
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-14">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">V1-6</p>
          <h1 className="text-3xl font-semibold tracking-tight">Bounty board</h1>
          <p className="text-zinc-600 dark:text-zinc-400">{LOCK_NOT_MONEY_COPY}</p>
          <p className="text-sm text-zinc-500">
            Exclusive claim-lock is {CLAIM_LOCK_HOURS}h (coordination only). After merge, the
            eligible hunter claims net-of-fee USDC. Face locks in gb-escrow; 2% is taken at
            settlement. Completed (paid) shows on the card.
          </p>
        </div>

        <form
          method="get"
          className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row sm:items-end dark:border-zinc-800 dark:bg-zinc-900"
        >
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Repo</span>
            <input
              name="repo"
              defaultValue={repo}
              placeholder="owner/repo"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Status</span>
            <select
              name="status"
              defaultValue={status}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="all">All</option>
              {bountyStatusValues.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Filter
          </button>
        </form>

        <p className="text-sm">
          <Link href="/bounties/new" className="underline underline-offset-4">
            Post a bounty
          </Link>
          {" · "}
          <Link href="/" className="underline underline-offset-4">
            Home
          </Link>
        </p>

        {loadError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        ) : bounties.length === 0 ? (
          <p className="text-sm text-zinc-500">No bounties match these filters.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {bounties.map((bounty) => (
              <li key={bounty.id}>
                <BountyCard bounty={bounty} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
