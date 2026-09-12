import Link from "next/link";
import { bountyStatusLabel, formatUsdc, payoutCaption, pendingHunterLinkCaption } from "@/bounties";
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
            {formatUsdc(bounty.amountUsdc)} {bounty.currency}
          </p>
          <p className="text-xs text-zinc-500">{bountyStatusLabel(bounty.status)}</p>
        </div>
      </div>
      {bounty.escrowFail ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-950 dark:bg-red-950/40 dark:text-red-100">
          Escrow fail · {bounty.escrowFail.code}
          {bounty.escrowFail.reason ? (
            <span className="mt-1 block text-xs opacity-90">{bounty.escrowFail.reason}</span>
          ) : null}
        </p>
      ) : null}
      {bounty.pendingHunterLink ? (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-950 dark:bg-sky-950/40 dark:text-sky-100">
          {pendingHunterLinkCaption(bounty.pendingHunterLink.winnerLogin)}
        </p>
      ) : null}
      {bounty.payout ? (
        <p
          className={
            bounty.payout.status === "paid"
              ? "rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100"
              : "rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-950 dark:bg-sky-950/40 dark:text-sky-100"
          }
        >
          {payoutCaption(bounty.payout)}
          {bounty.payout.payoutTxHash ? (
            <span className="mt-1 block break-all font-mono text-xs opacity-80">
              tx {bounty.payout.payoutTxHash}
            </span>
          ) : null}
        </p>
      ) : bounty.activeLock ? (
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
