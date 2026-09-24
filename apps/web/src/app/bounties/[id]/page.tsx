import Link from "next/link";
import { getCurrentPublicUser } from "@/auth/protect";
import {
  cancelBountyAction,
  claimPayoutAction,
  clearWorkSignalAction,
  fundBountyAction,
  signalWorkingOnThisAction,
  topUpBountyAction,
} from "@/app/actions/bounties";
import {
  bountyStatusLabel,
  formatUsdc,
  getBoardBounty,
  getPoolRoster,
  LOCK_NOT_MONEY_COPY,
  loadBountyIssueBody,
  pendingHunterLinkCaption,
} from "@/bounties";
import { BountyIntelligenceCard } from "@/components/bounty-intelligence-card";
import { ClaimPayoutPanel } from "@/components/claim-payout-form";
import { FundLockPanel } from "@/components/fund-lock-panel";
import { FunderContributionList } from "@/components/funder-contributions";
import { GitHubAvatar } from "@/components/github-avatar";
import { AppHeader } from "@/components/header";
import { IssueBodyCard } from "@/components/issue-body";
import { PayoutBreakdown } from "@/components/payout-breakdown";
import { PoolRoster } from "@/components/pool-roster";
import { WorkSignalsPanel } from "@/components/work-signals-panel";
import { getRuntimeDb } from "@/db/runtime";
import { githubLinks } from "@/db/schema";
import { getEscrowSnapshot, listBountyContributions } from "@/escrow";
import { loadBountyIntelligence } from "@/intelligence/load";
import { classifyIntelligenceFailure } from "@/intelligence/errors";
import { INTELLIGENCE_ESTIMATE_LABEL } from "@/intelligence/prompt";
import { walletConnectConfigured } from "@/wallet/env";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function BountyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string; refreshIntelligence?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const db = getRuntimeDb();
  const [user, bounty, escrow, roster, contributions] = await Promise.all([
    getCurrentPublicUser(),
    getBoardBounty(id, db).catch(() => null),
    getEscrowSnapshot(id, db).catch(() => null),
    getPoolRoster(id, db).catch(() => null),
    listBountyContributions(id, db).catch(() => []),
  ]);
  const viewerGithubId = user
    ? (
        await db
          .select({ githubId: githubLinks.githubId })
          .from(githubLinks)
          .where(eq(githubLinks.userId, user.id))
          .limit(1)
      )[0]?.githubId.toString() ?? null
    : null;

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

  const issue = await loadBountyIssueBody(bounty.id, db).catch(() => null);
  const intelligence = await loadBountyIntelligence({
    bountyId: bounty.id,
    repoFullName: bounty.repoFullName,
    githubIssueNumber: bounty.githubIssueNumber,
    issueTitle: issue?.title || bounty.title,
    issueBody: issue?.markdown ?? null,
    installationId: issue?.installationId ?? null,
    db,
    forceRefresh: query.refreshIntelligence === "1",
  }).catch((err) => ({
    status: "unavailable" as const,
    reason: "error" as const,
    errorReason: classifyIntelligenceFailure(err).code,
    estimateLabel: INTELLIGENCE_ESTIMATE_LABEL,
  }));

  const isPoster = user?.id === bounty.posterUserId;
  const isEligibleHunter = Boolean(user && bounty.payout && user.id === bounty.payout.hunterUserId);
  const canFund = Boolean(isPoster && bounty.status === "pending_fund");
  const canTopUp = Boolean(
    user && bounty.status === "funded" && !bounty.payout && !roster?.frozen,
  );
  const canSignal = Boolean(
    user &&
      (bounty.status === "pending_fund" ||
        bounty.status === "funded" ||
        bounty.status === "claim_locked"),
  );
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
  const signInHref = `/signin?callbackUrl=${encodeURIComponent(`/bounties/${bounty.id}`)}`;
  const winnerUsdc = roster?.breakdown.winnerUsdc;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-14">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            {bounty.repoFullName} · #{bounty.githubIssueNumber}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{bounty.title}</h1>
          <p className="text-lg font-medium">
            {formatUsdc(bounty.amountUsdc)} {bounty.currency} · {bountyStatusLabel(bounty.status)}
          </p>
        </div>

        <IssueBodyCard markdown={issue?.markdown ?? null} />
        <BountyIntelligenceCard intelligence={intelligence} />

        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {LOCK_NOT_MONEY_COPY}
        </p>

        <WorkSignalsPanel
          bountyId={bounty.id}
          signals={bounty.workSignals}
          viewerUserId={user?.id}
          canSignal={canSignal}
          signedIn={Boolean(user)}
          signInHref={signInHref}
          signalAction={signalWorkingOnThisAction}
          clearAction={clearWorkSignalAction}
        />

        {roster ? (
          <PoolRoster
            roster={roster}
            currency={bounty.currency}
            bountyId={bounty.id}
            viewerUserId={user?.id}
            viewerGithubId={viewerGithubId}
            winnerPaid={Boolean(
              bounty.payout?.status === "paid" || roster.winner?.paid || roster.breakdown.winnerTxHash,
            )}
            signedIn={Boolean(user)}
            signInHref={signInHref}
            defaultAddress={user?.wallet_address || ""}
            claimAction={claimPayoutAction}
          />
        ) : null}
        {roster ? <PayoutBreakdown roster={roster} currency={bounty.currency} /> : null}

        {bounty.pendingHunterLink ? (
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
            {pendingHunterLinkCaption(bounty.pendingHunterLink.winnerLogin)}{" "}
            <Link href="/settings" className="underline underline-offset-4">
              Connect GitHub
            </Link>{" "}
            as <code>{bounty.pendingHunterLink.winnerLogin}</code>
            {bounty.pendingHunterLink.prNumber != null
              ? ` (merged PR #${bounty.pendingHunterLink.prNumber})`
              : ""}
            . Signals do not assign payout.
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

        {bounty.escrowFail ? (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-950 dark:bg-red-950/40 dark:text-red-100">
            Escrow fail · {bounty.escrowFail.code}
            {bounty.escrowFail.reason ? (
              <span className="mt-1 block text-xs opacity-90">{bounty.escrowFail.reason}</span>
            ) : null}
          </p>
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
            signInHref={signInHref}
            escrowFail={bounty.escrowFail}
            winnerUsdc={winnerUsdc}
          />
        ) : null}

        {escrow ? (
          <dl className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white text-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Escrow</dt>
              <dd className="sm:col-span-2">
                {escrow.status} · rail {escrow.rail}
                {escrow.failCode ? ` · ${escrow.failCode}` : ""}
              </dd>
            </div>
            {escrow.failReason ? (
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Fail reason</dt>
                <dd className="sm:col-span-2 text-red-700 dark:text-red-400">{escrow.failReason}</dd>
              </div>
            ) : null}
            {escrow.inboundRecorded && escrow.status === "pending" ? (
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
                <dt className="text-xs uppercase tracking-wide text-zinc-500">x402 inbound</dt>
                <dd className="sm:col-span-2">Recorded — Lock without pasting a hash</dd>
              </div>
            ) : null}
            {escrow.fundTxHash ? (
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Fund tx</dt>
                <dd className="break-all sm:col-span-2">{escrow.fundTxHash}</dd>
              </div>
            ) : null}
            {escrow.payoutTxHash ? (
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Winner tx</dt>
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

        <FunderContributionList contributions={contributions} currency={bounty.currency} />

        <dl className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white text-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Poster</dt>
            <dd className="inline-flex items-center gap-2 sm:col-span-2">
              <GitHubAvatar login={bounty.posterGithubLogin} size={24} />
              {bounty.posterDisplayName}
            </dd>
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
            <FundLockPanel
              bountyId={bounty.id}
              faceUsdc={bounty.amountUsdc}
              currency={bounty.currency}
              inboundRecorded={Boolean(escrow?.inboundRecorded)}
              resourceUrl={`/api/bounties/${bounty.id}/x402`}
              escrowAddress={escrow?.escrowAddress ?? null}
              walletConnectConfigured={walletConnectConfigured()}
              fundAction={fundBountyAction}
            />
          ) : null}

          {canTopUp ? (
            <FundLockPanel
              mode="topup"
              bountyId={bounty.id}
              faceUsdc={bounty.amountUsdc}
              currency={bounty.currency}
              inboundRecorded={false}
              resourceUrl={`/api/bounties/${bounty.id}/x402`}
              escrowAddress={escrow?.escrowAddress ?? null}
              walletConnectConfigured={walletConnectConfigured()}
              fundAction={fundBountyAction}
              topUpAction={topUpBountyAction}
            />
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
                Unmerged cancel returns full face to the funder. No 2% fee. Bounty{" "}
                <code>expires_at</code> refunds are unchanged. Exclusive claim-lock is retired.
              </p>
            </form>
          ) : null}

          {!user ? (
            <p className="text-sm text-zinc-500">
              <Link href={signInHref} className="underline underline-offset-4">
                Sign in with Google
              </Link>{" "}
              to fund, add USDC to a funded bounty, signal Working on this, or claim a winner or pool payout.
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
