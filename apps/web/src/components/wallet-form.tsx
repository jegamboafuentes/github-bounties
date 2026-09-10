"use client";

import { useActionState } from "react";
import { saveWalletAddressAction, type BountyActionState } from "@/app/actions/bounties";

const initial: BountyActionState = { ok: true };

export function WalletForm({ defaultAddress }: { defaultAddress: string }) {
  const [state, action, pending] = useActionState(saveWalletAddressAction, initial);

  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Base payout address</span>
        <input
          name="walletAddress"
          type="text"
          required
          defaultValue={defaultAddress}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
      <p className="text-xs text-zinc-500">
        Bring-your-own Base address (0x + 40 hex). Used when you claim an eligible payout. No
        custodial wallet.
      </p>
      {state && !state.ok ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
      ) : null}
      {state?.ok && state.message ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-300">{state.message}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Saving…" : "Save address"}
      </button>
    </form>
  );
}
