import Link from "next/link";
import {
  ELIGIBILITY_FREEZE_COPY,
  formatUsdc,
  unlinkedPoolMemberCaption,
} from "@/bounties";
import type { PoolRosterView, RosterMemberView } from "@/bounties/roster";
import { GitHubAvatar } from "@/components/github-avatar";

function MemberRow({
  member,
  roleLabel,
  currency,
  showShare,
}: {
  member: RosterMemberView;
  roleLabel: string;
  currency: string;
  showShare: boolean;
}) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <GitHubAvatar login={member.githubLogin} size={20} />
        <span className="font-medium">{member.githubLogin}</span>
        <span className="text-xs uppercase tracking-wide text-zinc-500">{roleLabel}</span>
      </div>
      <div className="text-zinc-600 dark:text-zinc-400">
        {member.qualifyingPrUrl && member.qualifyingPrNumber != null ? (
          <a
            href={member.qualifyingPrUrl}
            className="underline underline-offset-4"
            target="_blank"
            rel="noreferrer"
          >
            PR #{member.qualifyingPrNumber}
          </a>
        ) : member.qualifyingPrNumber != null ? (
          <span>PR #{member.qualifyingPrNumber}</span>
        ) : (
          <span>No qualifying PR listed</span>
        )}
        {showShare ? (
          <>
            {" · "}
            share {formatUsdc(member.shareUsdc)} {currency}
          </>
        ) : null}
      </div>
      {member.payoutTxHash ? (
        <p className="break-all font-mono text-xs text-zinc-500">tx {member.payoutTxHash}</p>
      ) : null}
      {member.unlinked ? (
        <p className="text-sm text-sky-800 dark:text-sky-200">
          {unlinkedPoolMemberCaption(member.githubLogin)}{" "}
          <Link href="/settings" className="underline underline-offset-4">
            Connect GitHub
          </Link>{" "}
          as <code>{member.githubLogin}</code>.
        </p>
      ) : null}
    </li>
  );
}

export function PoolRoster({
  roster,
  currency,
}: {
  roster: PoolRosterView;
  currency: string;
}) {
  const hasRows =
    Boolean(roster.winner) ||
    roster.pool.length > 0 ||
    roster.overflowCount > 0 ||
    Boolean(roster.excludedPoster) ||
    roster.candidates.length > 0;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Pool roster
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {roster.frozen
            ? "Eligibility is frozen at the winning merge."
            : ELIGIBILITY_FREEZE_COPY}
        </p>
      </div>

      {!hasRows ? (
        <p className="text-sm text-zinc-500">
          No pool candidates yet. Empty pool → winner receives 100% of post-fee.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {roster.winner ? (
            <MemberRow
              member={roster.winner}
              roleLabel="Winner"
              currency={currency}
              showShare
            />
          ) : null}
          {roster.pool.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              roleLabel="Pool"
              currency={currency}
              showShare
            />
          ))}
          {roster.excludedPoster ? (
            <MemberRow
              member={roster.excludedPoster}
              roleLabel="Excluded poster"
              currency={currency}
              showShare={false}
            />
          ) : null}
          {roster.candidates.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              roleLabel="Candidate"
              currency={currency}
              showShare={false}
            />
          ))}
        </ul>
      )}

      {roster.overflowCaption ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{roster.overflowCaption}</p>
      ) : null}
    </section>
  );
}
