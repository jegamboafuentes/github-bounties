"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { isWalletConnectConnector, shortenAddress } from "@/wallet/config";
import { useFundWallet } from "@/wallet/providers";

export function ConnectWalletButtons({
  walletConnectConfigured,
  purpose = "fund",
}: {
  walletConnectConfigured: boolean;
  purpose?: "fund" | "payout";
}) {
  const fund = useFundWallet();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const wrongChain = isConnected && chainId !== fund.chainId;
  const chainHint =
    purpose === "payout"
      ? wrongChain
        ? ` · switch to ${fund.chainName} if you also fund from this wallet`
        : ` · ${fund.chainName}`
      : wrongChain
        ? ` · switch to ${fund.chainName} to pay`
        : ` · ${fund.chainName}`;

  if (isConnected && address) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Connected {shortenAddress(address)}
          {chainHint}
        </p>
        <div className="flex flex-wrap gap-2">
          {wrongChain && purpose === "fund" ? (
            <button
              type="button"
              disabled={isSwitching}
              onClick={() => switchChain({ chainId: fund.chainId })}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              {isSwitching ? "Switching…" : `Switch to ${fund.chainName}`}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => disconnect()}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  const walletConnect = connectors.find(isWalletConnectConnector);
  const injected = connectors.find((c) => c.id === "injected" || c.type === "injected");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {walletConnect ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => connect({ connector: walletConnect, chainId: fund.chainId })}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {isPending ? "Connecting…" : "WalletConnect"}
          </button>
        ) : null}
        {injected ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => connect({ connector: injected, chainId: fund.chainId })}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
          >
            Browser wallet
          </button>
        ) : null}
      </div>
      {!walletConnectConfigured ? (
        <p className="text-xs text-zinc-500">
          WalletConnect QR needs Ops to set{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
            NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
          </code>{" "}
          (Reown Cloud project id, not a secret). Browser wallets still work.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
      ) : null}
    </div>
  );
}
