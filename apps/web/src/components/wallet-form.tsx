"use client";

import { useActionState } from "react";
import { useAccount } from "wagmi";
import { saveWalletAddressAction, type BountyActionState } from "@/app/actions/bounties";
import { ConnectWalletButtons } from "@/components/connect-wallet";
import { shortenAddress } from "@/wallet/config";

const initial: BountyActionState = { ok: true };

export function WalletForm({
  defaultAddress,
  walletConnectConfigured,
}: {
  defaultAddress: string;
  walletConnectConfigured: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ConnectWalletButtons walletConnectConfigured={walletConnectConfigured} purpose="payout" />
      <SaveConnectedAddress savedAddress={defaultAddress} />
      <details className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
        <summary className="cursor-pointer font-medium">Advanced: paste a Base address</summary>
        <ManualAddressForm defaultAddress={defaultAddress} />
      </details>
    </div>
  );
}

function SaveConnectedAddress({ savedAddress }: { savedAddress: string }) {
  const { address, isConnected } = useAccount();
  const [state, action, pending] = useActionState(saveWalletAddressAction, initial);
  const alreadySaved = Boolean(
    address && savedAddress && address.toLowerCase() === savedAddress.toLowerCase(),
  );

  if (!isConnected || !address) {
    return (
      <p className="text-xs text-zinc-500">
        Connect with WalletConnect (same Reown project as fund / Lock) to set your payout address.
        Browser wallets work too.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="walletAddress" value={address} />
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        {alreadySaved
          ? `${shortenAddress(address)} is already your payout address.`
          : `Save ${shortenAddress(address)} as your payout address.`}
      </p>
      <ActionFeedback state={state} />
      <button
        type="submit"
        disabled={pending || alreadySaved}
        className="w-fit rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Saving…" : alreadySaved ? "Saved" : "Use this address"}
      </button>
    </form>
  );
}

function ManualAddressForm({ defaultAddress }: { defaultAddress: string }) {
  const [state, action, pending] = useActionState(saveWalletAddressAction, initial);

  return (
    <form action={action} className="mt-3 flex flex-col gap-3">
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
      <ActionFeedback state={state} />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-60 dark:border-zinc-700"
      >
        {pending ? "Saving…" : "Save pasted address"}
      </button>
    </form>
  );
}

function ActionFeedback({ state }: { state: BountyActionState | null }) {
  if (!state) return null;
  if (!state.ok) {
    return <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>;
  }
  if (state.message) {
    return <p className="text-sm text-emerald-700 dark:text-emerald-300">{state.message}</p>;
  }
  return null;
}
