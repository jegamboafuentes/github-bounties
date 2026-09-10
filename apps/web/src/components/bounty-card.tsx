import Link from "next/link";
import { bountyStatusLabel } from "@/bounties";
import type { BoardBounty } from "@/bounties/list";

export function BountyCard({ bounty }: { bounty: BoardBounty }) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            {bounty.repoFullName} · #{bounty.githubIssueNumber}
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">
            <Link href={`/bounties/${bounty.id}`} className="underline-offset-4 hover:underline">
              {bounty.title}
            </Link>
          </h2>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">
            {trimUsdc(bounty.amountUsdc)} {bounty.currency}
          </p>
          <p className="text-xs text-zinc-500">{bountyStatusLabel(bounty.status)}</p>
        </div>
      </div>
      {bounty.activeLock ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
          {bounty.activeLock.caption}
        </p>
      ) : null}
      <p className="text-xs text-zinc-500">
        Posted by {bounty.posterDisplayName}
        {" · "}
        <a href={bounty.url} className="underline underline-offset-4" target="_blank" rel="noreferrer">
          GitHub issue
        </a>
      </p>
    </article>
  );
}

function trimUsdc(value: string): string {
  return value.replace(/\.?0+$/, "") || "0";
}
