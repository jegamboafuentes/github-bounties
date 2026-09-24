import Link from "next/link";
import {
  bountyStatusLabel,
  formatUsdc,
  payoutCaption,
  pendingHunterLinkCaption,
  workingOnThisCaption,
} from "@/bounties";
import type { BoardBounty } from "@/bounties/list";
import { FunderAvatarStack } from "@/components/funder-avatar-stack";
import { GitHubAvatar } from "@/components/github-avatar";

const COMPLEXITY_BADGE: Record<"S" | "M" | "L", string> = {
  S: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
  M: "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100",
  L: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
};

function ComplexityDots({ value }: { value: "S" | "M" | "L" }) {
  const filled = value === "S" ? 1 : value === "M" ? 2 : 3;
  return (
    <span aria-hidden className="inline-flex items-center gap-0.5">
      {([1, 2, 3] as const).map((index) => (
        <span
          key={index}
          className={`h-1.5 w-1.5 rounded-full ${index <= filled ? "bg-current" : "bg-current/25"}`}
        />
      ))}
    </span>
  );
}

export function BountyCard({ bounty }: { bounty: BoardBounty }) {
  const signalCaption = workingOnThisCaption(bounty.workSignals);
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
          {bounty.intelligence ? (
            <p className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${COMPLEXITY_BADGE[bounty.intelligence.complexity]}`}
                title={`Complexity ${bounty.intelligence.complexity} · AI estimate — not a guarantee`}
              >
                <ComplexityDots value={bounty.intelligence.complexity} />
                {bounty.intelligence.complexity}
              </span>
              <span
                className="inline-flex max-w-full items-center rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                title="Language / stack · AI estimate — not a guarantee"
              >
                <span className="truncate">{bounty.intelligence.languageStack}</span>
              </span>
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="text-right">
            <p className="text-lg font-semibold">
              {formatUsdc(bounty.amountUsdc)} {bounty.currency}
            </p>
            <p className="text-xs text-zinc-500">{bountyStatusLabel(bounty.status)}</p>
          </div>
          <FunderAvatarStack funders={bounty.funders} funderCount={bounty.funderCount} />
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
        <p className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-950 dark:bg-sky-950/40 dark:text-sky-100">
          <GitHubAvatar login={bounty.pendingHunterLink.winnerLogin} size={20} className="mt-0.5" />
          <span>{pendingHunterLinkCaption(bounty.pendingHunterLink.winnerLogin)}</span>
        </p>
      ) : null}
      {bounty.payout ? (
        <p
          className={
            bounty.payout.status === "paid"
              ? "flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100"
              : "flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-950 dark:bg-sky-950/40 dark:text-sky-100"
          }
        >
          <GitHubAvatar login={bounty.payout.githubLogin} size={20} className="mt-0.5" />
          <span>
            {payoutCaption(bounty.payout)}
            {bounty.payout.payoutTxHash ? (
              <span className="mt-1 block break-all font-mono text-xs opacity-80">
                tx {bounty.payout.payoutTxHash}
              </span>
            ) : null}
          </span>
        </p>
      ) : signalCaption ? (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-100">
          {bounty.workSignals.map((row) => (
            <GitHubAvatar key={row.id} login={row.githubLogin} size={20} />
          ))}
          <span>{signalCaption}</span>
        </p>
      ) : null}
      <p className="flex items-center gap-2 text-xs text-zinc-500">
        <GitHubAvatar login={bounty.posterGithubLogin} size={20} />
        <span>
          Posted by {bounty.posterDisplayName}
          {" · "}
          <a href={bounty.url} className="underline underline-offset-4" target="_blank" rel="noreferrer">
            GitHub issue
          </a>
        </span>
      </p>
    </article>
  );
}
