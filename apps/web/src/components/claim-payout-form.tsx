import {
  CLAIM_PAYOUT_COPY,
  HOSTED_CHECKOUT_DISABLED_COPY,
  claimStatusLabel,
  formatUsdc,
  payoutBreakdown,
} from "@/bounties";
import type { PayoutClaimView } from "@/claims";
import { FEE_BPS } from "@/lib/constants";

export function ClaimPayoutPanel({
  bountyId,
  faceUsdc,
  currency,
  payout,
  canClaim,
  defaultAddress,
  action,
  signedIn,
  signInHref,
  escrowFail,
}: {
  bountyId: string;
  faceUsdc: string;
  currency: string;
  payout: PayoutClaimView;
  canClaim: boolean;
  defaultAddress: string;
  action: (formData: FormData) => void | Promise<void>;
  signedIn: boolean;
  signInHref: string;
  escrowFail?: { code: string; reason: string } | null;
}) {
  const split = payoutBreakdown(faceUsdc);
  const paid = payout.status === "paid";
  const net = payout.payoutUsdc ?? split.hunterUsdc;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Claim payout
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{CLAIM_PAYOUT_COPY}</p>
      </div>

      <dl className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
        <div className="grid gap-1 px-3 py-2 sm:grid-cols-3">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Claim</dt>
          <dd className="sm:col-span-2">{claimStatusLabel(payout.status)}</dd>
        </div>
        <div className="grid gap-1 px-3 py-2 sm:grid-cols-3">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Hunter</dt>
          <dd className="sm:col-span-2">
            {payout.hunterLabel}
            {payout.prUrl ? (
              <>
                {" · "}
                <a
                  href={payout.prUrl}
                  className="underline underline-offset-4"
                  target="_blank"
                  rel="noreferrer"
                >
                  PR{payout.prNumber != null ? ` #${payout.prNumber}` : ""}
                </a>
              </>
            ) : null}
          </dd>
        </div>
        <div className="grid gap-1 px-3 py-2 sm:grid-cols-3">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Face</dt>
          <dd className="sm:col-span-2">
            {formatUsdc(split.faceUsdc)} {currency}
          </dd>
        </div>
        <div className="grid gap-1 px-3 py-2 sm:grid-cols-3">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Fee ({FEE_BPS / 100}%)</dt>
          <dd className="sm:col-span-2">
            {formatUsdc(split.feeUsdc)} {currency}
          </dd>
        </div>
        <div className="grid gap-1 px-3 py-2 sm:grid-cols-3">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Net to hunter</dt>
          <dd className="sm:col-span-2 font-medium">
            {formatUsdc(net)} {currency}
          </dd>
        </div>
        {payout.payoutAddress ? (
          <div className="grid gap-1 px-3 py-2 sm:grid-cols-3">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Paid to</dt>
            <dd className="break-all font-mono text-xs sm:col-span-2">{payout.payoutAddress}</dd>
          </div>
        ) : null}
        {payout.payoutTxHash ? (
          <div className="grid gap-1 px-3 py-2 sm:grid-cols-3">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Payout tx</dt>
            <dd className="break-all font-mono text-xs sm:col-span-2">{payout.payoutTxHash}</dd>
          </div>
        ) : null}
        {escrowFail ? (
          <div className="grid gap-1 px-3 py-2 sm:grid-cols-3">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Escrow fail</dt>
            <dd className="sm:col-span-2 text-red-700 dark:text-red-400">
              {escrowFail.code}
              {escrowFail.reason ? (
                <span className="mt-1 block text-xs">{escrowFail.reason}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

      {escrowFail && canClaim ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-950 dark:bg-red-950/40 dark:text-red-100">
          Last settle failed · {escrowFail.code}. Claim stays retryable after Ops
          fixes the rail (e.g. ETH gas on gb-escrow).
          {escrowFail.reason ? (
            <span className="mt-1 block text-xs opacity-90">{escrowFail.reason}</span>
          ) : null}
        </p>
      ) : null}

      {canClaim ? (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="bountyId" value={bountyId} />
          <input type="hidden" name="claimId" value={payout.id} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Base payout address</span>
            <input
              name="payoutAddress"
              type="text"
              required
              defaultValue={defaultAddress}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Claim {formatUsdc(split.hunterUsdc)} {currency}
          </button>
          <p className="text-xs text-zinc-500">
            Saves this address on your account. Triggers the V1-5 escrow release (mock rail until
            CDP_* is set). {HOSTED_CHECKOUT_DISABLED_COPY}
          </p>
        </form>
      ) : paid ? (
        <p className="text-sm text-emerald-800 dark:text-emerald-300">
          Payout complete. Poster and the board show completed (paid).
        </p>
      ) : signedIn ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Only {payout.hunterLabel} (the merged PR author) can claim this payout.
        </p>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <a href={signInHref} className="underline underline-offset-4">
            Sign in with Google
          </a>{" "}
          as {payout.hunterLabel} to claim net-of-fee USDC.
        </p>
      )}
    </section>
  );
}
