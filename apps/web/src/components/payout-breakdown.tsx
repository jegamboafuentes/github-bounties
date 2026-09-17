import { formatUsdc, POOL_PAYOUT_COPY } from "@/bounties";
import type { PoolRosterView } from "@/bounties/roster";
import { FEE_BPS } from "@/lib/constants";

export function PayoutBreakdown({
  roster,
  currency,
}: {
  roster: PoolRosterView;
  currency: string;
}) {
  const { breakdown, legs } = roster;
  const confirmedLegs = legs.filter((leg) => leg.txHash);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Payout breakdown
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{POOL_PAYOUT_COPY}</p>
      </div>

      <dl className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
        <div className="grid gap-1 px-3 py-2 sm:grid-cols-3">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Face</dt>
          <dd className="sm:col-span-2">
            {formatUsdc(breakdown.faceUsdc)} {currency}
          </dd>
        </div>
        <div className="grid gap-1 px-3 py-2 sm:grid-cols-3">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Fee ({FEE_BPS / 100}%)</dt>
          <dd className="sm:col-span-2">
            {formatUsdc(breakdown.feeUsdc)} {currency}
            {breakdown.feeTxHash ? (
              <span className="mt-1 block break-all font-mono text-xs text-zinc-500">
                tx {breakdown.feeTxHash}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="grid gap-1 px-3 py-2 sm:grid-cols-3">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">
            Winner ({breakdown.winnerShareLabel})
          </dt>
          <dd className="sm:col-span-2 font-medium">
            {formatUsdc(breakdown.winnerUsdc)} {currency}
            {breakdown.winnerTxHash ? (
              <span className="mt-1 block break-all font-mono text-xs font-normal text-zinc-500">
                tx {breakdown.winnerTxHash}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="grid gap-1 px-3 py-2 sm:grid-cols-3">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">
            Pool ({breakdown.poolShareLabel})
          </dt>
          <dd className="sm:col-span-2">
            {breakdown.emptyPool
              ? `0 ${currency} — empty pool, winner receives 100% of post-fee`
              : `${formatUsdc(breakdown.poolTotalUsdc)} ${currency}`}
          </dd>
        </div>
        {breakdown.eachUsdc && breakdown.paidCount > 0 ? (
          <div className="grid gap-1 px-3 py-2 sm:grid-cols-3">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Each pool member</dt>
            <dd className="sm:col-span-2">
              {formatUsdc(breakdown.eachUsdc)} {currency} × {breakdown.paidCount}
            </dd>
          </div>
        ) : null}
        {confirmedLegs
          .filter((leg) => leg.kind === "POOL_PAYOUT")
          .map((leg) => (
            <div key={`${leg.kind}-${leg.participantId}`} className="grid gap-1 px-3 py-2 sm:grid-cols-3">
              <dt className="text-xs uppercase tracking-wide text-zinc-500">
                Pool tx{leg.githubLogin ? ` · ${leg.githubLogin}` : ""}
              </dt>
              <dd className="break-all font-mono text-xs sm:col-span-2">
                {formatUsdc(leg.amountUsdc)} {currency} · {leg.txHash}
              </dd>
            </div>
          ))}
      </dl>
    </section>
  );
}
