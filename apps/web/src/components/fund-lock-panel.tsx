"use client";

import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import {
  FUND_LOCK_COPY,
  HOSTED_CHECKOUT_DISABLED_COPY,
  X402_EXACT_FUND_COPY,
  formatUsdc,
} from "@/bounties/display";
import { ConnectWalletButtons } from "@/components/connect-wallet";
import { FUND_CHAIN } from "@/wallet/config";
import { lockAfterInbound, payX402Exact } from "@/wallet/pay-x402";

export function FundLockPanel({
  bountyId,
  faceUsdc,
  currency,
  inboundRecorded,
  resourceUrl,
  escrowAddress,
  walletConnectConfigured,
  fundAction,
}: {
  bountyId: string;
  faceUsdc: string;
  currency: string;
  inboundRecorded: boolean;
  resourceUrl: string;
  escrowAddress: string | null;
  walletConnectConfigured: boolean;
  fundAction: (formData: FormData) => void | Promise<void>;
}) {
  const face = formatUsdc(faceUsdc);
  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [busy, setBusy] = useState<"pay" | "lock" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paidInbound, setPaidInbound] = useState(inboundRecorded);
  const readyToPay = Boolean(isConnected && address && chainId === FUND_CHAIN.id && walletClient);
  const showPay = !paidInbound;

  async function onPay() {
    if (!walletClient || !address) {
      setError("Connect a Base Sepolia wallet first.");
      return;
    }
    setBusy("pay");
    setError(null);
    setMessage(null);
    try {
      const paid = await payX402Exact({
        resourceUrl,
        signer: {
          address,
          signTypedData: async (typed) =>
            walletClient.signTypedData({
              account: address,
              domain: typed.domain,
              types: typed.types,
              primaryType: typed.primaryType,
              message: typed.message,
            }),
        },
      });
      if (!paid.ok) {
        setError(`${paid.error}: ${paid.message}`);
        return;
      }
      setPaidInbound(true);
      setMessage(paid.message || "Payment recorded. Locking in escrow…");
      const locked = await lockAfterInbound(bountyId);
      if (!locked.ok) {
        setError(`${locked.error}: ${locked.message}`);
        setMessage("Payment recorded. Use Lock in escrow — no hash paste.");
        return;
      }
      setMessage("Paid and locked. Reloading…");
      window.location.assign(`/bounties/${bountyId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pay failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Fund / Lock
        </h2>
        <p className="mt-1 text-lg font-medium">
          Face {face} {currency}
        </p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{X402_EXACT_FUND_COPY}</p>
      </div>

      {paidInbound ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          Inbound USDC is recorded. Lock in escrow — no explorer copy-paste.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <ConnectWalletButtons walletConnectConfigured={walletConnectConfigured} />
          <button
            type="button"
            disabled={!readyToPay || busy !== null}
            onClick={() => void onPay()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy === "pay"
              ? "Paying…"
              : `Pay ${face} ${currency} with wallet`}
          </button>
          <p className="text-xs text-zinc-500">
            One-tap: x402 exact to gb-escrow
            {escrowAddress ? (
              <>
                {" "}
                (<code className="break-all">{escrowAddress}</code>)
              </>
            ) : null}{" "}
            on Base Sepolia, then Lock. Hosted Coinbase checkout stays disabled.
          </p>
        </div>
      )}

      {message ? (
        <p className="text-sm text-emerald-800 dark:text-emerald-300">{message}</p>
      ) : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <form action={fundAction} className="flex flex-col gap-3">
        <input type="hidden" name="bountyId" value={bountyId} />
        <button
          type="submit"
          disabled={busy !== null}
          className={
            paidInbound
              ? "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
          }
        >
          Lock in escrow
        </button>
      </form>

      {showPay ? (
        <details className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
          <summary className="cursor-pointer font-medium">
            Advanced: paste a fund tx hash
          </summary>
          <form action={fundAction} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="bountyId" value={bountyId} />
            <label className="flex flex-col gap-1">
              <span className="font-medium">Fund tx hash</span>
              <input
                name="fundTxHash"
                type="text"
                placeholder="0x… only if you sent USDC without the wallet button"
                autoComplete="off"
                spellCheck={false}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
            >
              Lock with pasted hash
            </button>
          </form>
        </details>
      ) : null}

      <p className="text-xs text-zinc-500">{FUND_LOCK_COPY}</p>
      <p className="text-xs text-zinc-500">{HOSTED_CHECKOUT_DISABLED_COPY}</p>
    </section>
  );
}
