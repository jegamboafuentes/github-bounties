import { formatUsdc } from "@/bounties/display";
import { FunderFace } from "@/components/funder-avatar-stack";

export type FunderContributionRow = {
  id: string;
  displayName: string;
  amountUsdc: string;
  avatarUrl: string | null;
};

/**
 * One row per contribution, oldest first. A repeat top-up stays its own row
 * and still shows that funder's face.
 */
export function FunderContributionList({
  contributions,
  currency,
}: {
  contributions: readonly FunderContributionRow[];
  currency: string;
}) {
  if (contributions.length === 0) return null;
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Funders</h2>
      <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
        {contributions.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 py-2">
            <span className="inline-flex min-w-0 items-center gap-2">
              <FunderFace displayName={row.displayName} avatarUrl={row.avatarUrl} />
              <span>{row.displayName}</span>
            </span>
            <span className="shrink-0 font-medium">
              {formatUsdc(row.amountUsdc)} {currency}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
