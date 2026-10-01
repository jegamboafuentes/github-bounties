"use client";

import { useState } from "react";
import {
  deleteBountyAction,
  executeWithdrawAction,
  previewWithdrawAction,
  setFeeBpsAction,
  setPoolBpsAction,
} from "@/app/actions/admin";

export type AdminDashboardData = {
  actorEmail: string;
  network: string;
  feeBps: number;
  poolBps: number;
  escrowAddress: string;
  feeAddress: string;
  escrowOnChainUsdc: string;
  escrowLiabilitiesUsdc: string;
  feeOnChainUsdc: string;
  feesEarnedUsdc: string;
  feesWithdrawnUsdc: string;
  withdrawEnabled: boolean;
  fixture?: {
    step?: "withdraw" | "delete";
    destination?: string;
    amountUsdc?: string;
    deleteError?: string;
  };
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function AdminDashboard({ data }: { data: AdminDashboardData }) {
  const [feeMessage, setFeeMessage] = useState<string | null>(null);
  const [poolMessage, setPoolMessage] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(data.fixture?.deleteError ?? null);
  const [preview, setPreview] = useState<{
    amountUsdc: string;
    destination: string;
    network: string;
    confirmToken: string;
    feeBalanceUsdc: string;
  } | null>(
    data.fixture?.step === "withdraw"
      ? {
          amountUsdc: data.fixture.amountUsdc ?? "0.100000",
          destination: data.fixture.destination ?? data.feeAddress,
          network: data.network,
          confirmToken: "fixture-token",
          feeBalanceUsdc: data.feeOnChainUsdc,
        }
      : null,
  );
  const [typed, setTyped] = useState("");
  const [withdrawMessage, setWithdrawMessage] = useState<string | null>(null);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <header>
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Admin</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">GitHub Bounties</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {data.actorEmail} · {data.network}. Escrow is view only.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Settings for new bounties">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Existing bounties keep the fee and pool stamped at creation.
          </p>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void setFeeBpsAction(new FormData(event.currentTarget)).then((result) => {
                setFeeMessage(result.ok ? `Fee is ${result.feeBps} bps.` : result.message);
              });
            }}
          >
            <label className="text-sm">
              Fee bps
              <input
                name="feeBps"
                defaultValue={data.feeBps}
                inputMode="numeric"
                className="mt-1 block w-28 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <button className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900" type="submit">
              Save fee
            </button>
          </form>
          {feeMessage ? <p className="mt-2 text-sm">{feeMessage}</p> : null}
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void setPoolBpsAction(new FormData(event.currentTarget)).then((result) => {
                setPoolMessage(result.ok ? `Pool is ${result.poolBps} bps.` : result.message);
              });
            }}
          >
            <label className="text-sm">
              Pool bps of post-fee
              <input
                name="poolBps"
                defaultValue={data.poolBps}
                inputMode="numeric"
                className="mt-1 block w-28 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <button className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900" type="submit">
              Save pool
            </button>
          </form>
          {poolMessage ? <p className="mt-2 text-sm">{poolMessage}</p> : null}
        </Card>

        <Card title="Balances">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Escrow on-chain</dt>
              <dd className="mt-1 font-mono text-lg">{data.escrowOnChainUsdc}</dd>
              <dd className="mt-1 break-all text-xs text-zinc-500">{data.escrowAddress}</dd>
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Escrow liabilities</dt>
              <dd className="mt-1 font-mono text-lg">{data.escrowLiabilitiesUsdc}</dd>
              <dd className="mt-1 text-xs text-zinc-500">Database, view only</dd>
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Fee on-chain</dt>
              <dd className="mt-1 font-mono text-lg">{data.feeOnChainUsdc}</dd>
              <dd className="mt-1 break-all text-xs text-zinc-500">{data.feeAddress}</dd>
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Fees earned in DB</dt>
              <dd className="mt-1 font-mono text-lg">{data.feesEarnedUsdc}</dd>
              <dd className="mt-1 text-xs text-zinc-500">Withdrawn {data.feesWithdrawnUsdc}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card title="Withdraw fees">
        {data.withdrawEnabled ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Sends from the fee wallet on {data.network}. Type the destination to confirm.
          </p>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Withdraw is off until ADMIN_WITHDRAW_ENABLED=1.</p>
        )}
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (data.fixture) return;
            void previewWithdrawAction(new FormData(event.currentTarget)).then((result) => {
              if (!result.ok) {
                setWithdrawMessage(result.message);
                setPreview(null);
                return;
              }
              setPreview(result.preview);
              setTyped("");
              setWithdrawMessage(null);
            });
          }}
        >
          <label className="text-sm">
            Amount USDC
            <input
              name="amountUsdc"
              defaultValue={data.fixture?.amountUsdc ?? ""}
              required
              className="mt-1 block w-36 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="min-w-72 flex-1 text-sm">
            Destination
            <input
              name="destination"
              defaultValue={data.fixture?.destination ?? ""}
              required
              spellCheck={false}
              className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <button
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            type="submit"
            disabled={!data.withdrawEnabled && !data.fixture}
          >
            Preview
          </button>
        </form>
        {preview ? (
          <form
            className="mt-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"
            onSubmit={(event) => {
              event.preventDefault();
              if (data.fixture) return;
              void executeWithdrawAction(new FormData(event.currentTarget)).then((result) => {
                setWithdrawMessage(result.ok ? `Sent ${result.sent.txHash}` : result.message);
              });
            }}
          >
            <p>
              Send <span className="font-mono">{preview.amountUsdc}</span> USDC to{" "}
              <span className="break-all font-mono text-xs">{preview.destination}</span> on {preview.network}. Fee
              balance {preview.feeBalanceUsdc}.
            </p>
            <input type="hidden" name="confirmToken" value={preview.confirmToken} />
            <label>
              Type the destination address to confirm
              <input
                name="confirmation"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <button
              type="submit"
              disabled={typed !== preview.destination}
              className="w-fit rounded-lg bg-amber-700 px-3 py-2 text-white disabled:opacity-40"
            >
              Withdraw fees
            </button>
          </form>
        ) : null}
        {withdrawMessage ? <p className="mt-2 text-sm">{withdrawMessage}</p> : null}
      </Card>

      <Card title="Soft-delete an unfunded bounty">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (data.fixture?.deleteError) return;
            void deleteBountyAction(new FormData(event.currentTarget)).then((result) => {
              setDeleteMessage(result.ok ? `Deleted ${result.id}` : `${result.error}: ${result.message}`);
            });
          }}
        >
          <label className="min-w-72 flex-1 text-sm">
            Bounty id
            <input
              name="bountyId"
              required
              placeholder="uuid"
              className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <button className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900" type="submit">
            Delete
          </button>
        </form>
        {deleteMessage ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{deleteMessage}</p> : null}
      </Card>
    </main>
  );
}
