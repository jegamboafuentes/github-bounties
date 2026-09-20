import Link from "next/link";
import {
  ELIGIBILITY_FREEZE_COPY,
  formatUsdc,
  sharePaidLabel,
  unlinkedPoolMemberCaption,
} from "@/bounties";
import type { PoolRosterView, RosterMemberView } from "@/bounties/roster";
import { GitHubAvatar } from "@/components/github-avatar";
import { PoolClaimForm } from "@/components/pool-claim-form";

function MemberRow({
  member,
  roleLabel,
  currency,
  showShare,
  canClaimPool,
  bountyId,
  defaultAddress,
  claimAction,
}: {
  member: RosterMemberView;
  roleLabel: string;
  currency: string;
  showShare: boolean;
  canClaimPool?: boolean;
  bountyId?: string;
  defaultAddress?: string;
  claimAction?: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <GitHubAvatar login={member.githubLogin} size={20} />
        <span className="font-medium">{member.githubLogin}</span>
        <span className="text-xs uppercase tracking-wide text-zinc-500">{roleLabel}</span>
        {showShare ? (
          <span
            className={
              member.paid
                ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                : "rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            }
          >
            {sharePaidLabel(member.paid)}
          </span>
        ) : null}
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
      {canClaimPool && bountyId && claimAction ? (
        <PoolClaimForm
          bountyId={bountyId}
          participantId={member.id}
          shareUsdc={member.shareUsdc}
          currency={currency}
          defaultAddress={defaultAddress ?? ""}
          action={claimAction}
        />
      ) : null}
    </li>
  );
}

export function PoolRoster({
  roster,
  currency,
  bountyId,
  viewerUserId,
  viewerGithubId,
  winnerPaid,
  signedIn,
  signInHref,
  defaultAddress,
  claimAction,
}: {
  roster: PoolRosterView;
  currency: string;
  bountyId?: string;
  viewerUserId?: string | null;
  viewerGithubId?: string | null;
  winnerPaid?: boolean;
  signedIn?: boolean;
  signInHref?: string;
  defaultAddress?: string;
  claimAction?: (formData: FormData) => void | Promise<void>;
}) {
  const hasRows =
    Boolean(roster.winner) ||
    roster.pool.length > 0 ||
    roster.overflowCount > 0 ||
    Boolean(roster.excludedPoster) ||
    roster.candidates.length > 0;
  const isViewerMember = (row: RosterMemberView) =>
    Boolean(
      (viewerUserId && row.userId === viewerUserId) ||
        (viewerGithubId && row.githubId === viewerGithubId),
    );
  const viewerPool = roster.pool.find(isViewerMember);

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
          {roster.pool.map((member) => {
            const isViewer = isViewerMember(member);
            const canClaimPool = Boolean(
              isViewer &&
                roster.frozen &&
                !member.paid &&
                winnerPaid &&
                claimAction &&
                bountyId,
            );
            return (
              <MemberRow
                key={member.id}
                member={member}
                roleLabel="Pool"
                currency={currency}
                showShare
                canClaimPool={canClaimPool}
                bountyId={bountyId}
                defaultAddress={defaultAddress}
                claimAction={claimAction}
              />
            );
          })}
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

      {viewerPool && roster.frozen && !viewerPool.paid && !winnerPaid ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Winner claims first. Your pool share stays reserved until then.
        </p>
      ) : null}

      {viewerPool && !signedIn && signInHref ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <a href={signInHref} className="underline underline-offset-4">
            Sign in with Google
          </a>{" "}
          to claim your pool share.
        </p>
      ) : null}

      {roster.overflowCaption ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{roster.overflowCaption}</p>
      ) : null}
    </section>
  );
}
