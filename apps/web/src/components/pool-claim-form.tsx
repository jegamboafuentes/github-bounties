import { formatUsdc, HOSTED_CHECKOUT_DISABLED_COPY, POOL_CLAIM_COPY } from "@/bounties";

export function PoolClaimForm({
  bountyId,
  participantId,
  shareUsdc,
  currency,
  defaultAddress,
  action,
}: {
  bountyId: string;
  participantId: string;
  shareUsdc: string;
  currency: string;
  defaultAddress: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="bountyId" value={bountyId} />
      <input type="hidden" name="kind" value="pool" />
      <input type="hidden" name="participantId" value={participantId} />
      <p className="text-xs text-zinc-500">{POOL_CLAIM_COPY}</p>
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
        Claim pool share {formatUsdc(shareUsdc)} {currency}
      </button>
      <p className="text-xs text-zinc-500">
        Saves this address on your account. Pays only your frozen pool leg.{" "}
        {HOSTED_CHECKOUT_DISABLED_COPY}
      </p>
    </form>
  );
}
