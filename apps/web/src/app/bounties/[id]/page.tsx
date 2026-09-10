import Link from "next/link";
import { getCurrentPublicUser } from "@/auth/protect";
import {
  acquireClaimLockAction,
  cancelBountyAction,
  claimPayoutAction,
  releaseClaimLockAction,
  fundBountyAction,
} from "@/app/actions/bounties";
import {
  bountyStatusLabel,
  formatUsdc,
  getBoardBounty,
  HOSTED_CHECKOUT_DISABLED_COPY,
  LOCK_NOT_MONEY_COPY,
  FUND_LOCK_COPY,
} from "@/bounties";
import { ClaimPayoutPanel } from "@/components/claim-payout-form";
import { AppHeader } from "@/components/header";
import { getRuntimeDb } from "@/db/runtime";
import { getEscrowSnapshot } from "@/escrow";
import { CLAIM_LOCK_HOURS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function BountyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const db = getRuntimeDb();
  const [user, bounty, escrow] = await Promise.all([
    getCurrentPublicUser(),
    getBoardBounty(id, db).catch(() => null),
    getEscrowSnapshot(id, db).catch(() => null),
  ]);

  if (!bounty) {
    return (
      <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        <AppHeader />
        <main className="mx-auto w-full max-w-xl px-6 py-14">
          <h1 className="text-2xl font-semibold">Bounty not found</h1>
          <p className="mt-3 text-sm">
            <Link href="/board" className="underline underline-offset-4">
              Back to board
            </Link>
          </p>
        </main>
      </div>
    );
  }

  const isPoster = user?.id === bounty.posterUserId;
  const isLockHolder = user?.id === bounty.activeLock?.hunterUserId;
  const isEligibleHunter = Boolean(user && bounty.payout && user.id === bounty.payout.hunterUserId);
  const canFund = Boolean(isPoster && bounty.status === "pending_fund");
  const canLock = Boolean(user && bounty.status === "funded" && !bounty.activeLock && !bounty.payout);
  const canRelease = Boolean(bounty.activeLock && (isLockHolder || isPoster) && !bounty.payout);
  const canCancel = Boolean(
    isPoster &&
      !bounty.payout &&
      (bounty.status === "pending_fund" ||
        bounty.status === "funded" ||
        bounty.status === "claim_locked"),
  );
  const canClaimPayout = Boolean(
    isEligibleHunter &&
      bounty.payout?.status === "eligible" &&
      (bounty.status === "funded" ||
        bounty.status === "claim_locked" ||
        bounty.status === "settling" ||
        bounty.status === "settled_partial"),
  );

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-6 py-14">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            {bounty.repoFullName} · #{bounty.githubIssueNumber}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{bounty.title}</h1>
          <p className="text-lg font-medium">
            {formatUsdc(bounty.amountUsdc)} {bounty.currency} · {bountyStatusLabel(bounty.status)}
          </p>
        </div>

        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {LOCK_NOT_MONEY_COPY}
        </p>

        {bounty.activeLock ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
            {bounty.activeLock.caption} ({CLAIM_LOCK_HOURS}h exclusive lock)
          </p>
        ) : null}

        {query.notice ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            {query.notice}
          </p>
        ) : null}

        {query.error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{query.error}</p>
        ) : null}

        {bounty.payout ? (
          <ClaimPayoutPanel
            bountyId={bounty.id}
            faceUsdc={bounty.amountUsdc}
            currency={bounty.currency}
            payout={bounty.payout}
            canClaim={canClaimPayout}
            defaultAddress={
              user?.wallet_address || bounty.payout.payoutAddress || ""
            }
            action={claimPayoutAction}
            signedIn={Boolean(user)}
            signInHref={`/signin?callbackUrl=${encodeURIComponent(`/bounties/${bounty.id}`)}`}
          />
        ) : null}

        {escrow ? (
          <dl className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white text-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Escrow</dt>
              <dd className="sm:col-span-2">
                {escrow.status} · rail {escrow.rail}
              </dd>
            </div>
            {escrow.fundTxHash ? (
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Fund tx</dt>
                <dd className="break-all sm:col-span-2">{escrow.fundTxHash}</dd>
              </div>
            ) : null}
            {escrow.payoutTxHash ? (
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Hunter tx</dt>
                <dd className="break-all sm:col-span-2">{escrow.payoutTxHash}</dd>
              </div>
            ) : null}
            {escrow.feeTxHash ? (
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Fee tx</dt>
                <dd className="break-all sm:col-span-2">{escrow.feeTxHash}</dd>
              </div>
            ) : null}
            {escrow.refundTxHash ? (
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Refund tx</dt>
                <dd className="break-all sm:col-span-2">{escrow.refundTxHash}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <dl className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white text-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Poster</dt>
            <dd className="sm:col-span-2">{bounty.posterDisplayName}</dd>
          </div>
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Issue</dt>
            <dd className="sm:col-span-2">
              <a href={bounty.url} className="underline underline-offset-4" target="_blank" rel="noreferrer">
                {bounty.url}
              </a>
            </dd>
          </div>
        </dl>

        <div className="flex flex-col gap-3">
          {canFund ? (
            <form action={fundBountyAction}>
              <input type="hidden" name="bountyId" value={bounty.id} />
              <button
                type="submit"
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                Lock in escrow
              </button>
              <p className="mt-2 text-xs text-zinc-500">{FUND_LOCK_COPY}</p>
              <p className="mt-1 text-xs text-zinc-500">{HOSTED_CHECKOUT_DISABLED_COPY}</p>
            </form>
          ) : null}

          {canLock ? (
            <form action={acquireClaimLockAction}>
              <input type="hidden" name="bountyId" value={bounty.id} />
              <button
                type="submit"
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                Claim for {CLAIM_LOCK_HOURS}h
              </button>
              <p className="mt-2 text-xs text-zinc-500">
                Exclusive coordination lock. Does not move USDC. Merge is still truth.
              </p>
            </form>
          ) : null}

          {canRelease ? (
            <form action={releaseClaimLockAction}>
              <input type="hidden" name="bountyId" value={bounty.id} />
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
              >
                {isPoster && !isLockHolder ? "Force-release lock" : "Release lock early"}
              </button>
            </form>
          ) : null}

          {canCancel ? (
            <form action={cancelBountyAction}>
              <input type="hidden" name="bountyId" value={bounty.id} />
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
              >
                {bounty.status === "pending_fund" ? "Cancel bounty" : "Cancel and refund"}
              </button>
              <p className="mt-2 text-xs text-zinc-500">
                Unmerged cancel returns full face to the funder. No 2% fee. Claim-lock expiry does
                not refund.
              </p>
            </form>
          ) : null}

          {!user ? (
            <p className="text-sm text-zinc-500">
              <Link
                href={`/signin?callbackUrl=${encodeURIComponent(`/bounties/${bounty.id}`)}`}
                className="underline underline-offset-4"
              >
                Sign in with Google
              </Link>{" "}
              to fund, claim-lock, or claim a payout.
            </p>
          ) : null}
        </div>

        <p className="text-sm text-zinc-500">
          <Link href="/board" className="underline underline-offset-4">
            Back to board
          </Link>
        </p>
      </main>
    </div>
  );
}
