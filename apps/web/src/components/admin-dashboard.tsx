"use client";

import { useState } from "react";
import {
  deleteBountyAction,
  executeWithdrawAction,
  previewWithdrawAction,
  refundBountyAction,
  setFeeBpsAction,
  setPoolBpsAction,
} from "@/app/actions/admin";
import type { AdminBountyRow } from "@/admin/bounties";
import { FEE_PERCENT_RANGE, POOL_PERCENT_RANGE } from "@/admin/percent";

export type AdminMoneyTile = { text: string; error: boolean };

export type AdminDashboardData = {
  actorEmail: string;
  network: string;
  feePercent: string;
  poolPercent: string;
  escrowAddress: string;
  feeAddress: string;
  escrowOnChain: AdminMoneyTile;
  liabilities: AdminMoneyTile;
  feeOnChain: AdminMoneyTile;
  feesEarned: AdminMoneyTile;
  feesWithdrawn: AdminMoneyTile;
  withdrawEnabled: boolean;
  bounties: {
    rows: AdminBountyRow[];
    total: number;
    page: number;
    pageCount: number;
    search: string;
    status: string;
  };
  statusOptions: { value: string; label: string }[];
  fixture?: {
    step?: "withdraw" | "delete" | "refund";
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

function Tile({ title, tile, detail }: { title: string; tile: AdminMoneyTile; detail: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{title}</dt>
      <dd className={`mt-1 ${tile.error ? "text-sm text-red-700 dark:text-red-300" : "font-mono text-lg"}`}>
        {tile.text}
      </dd>
      <dd className="mt-1 break-all text-xs text-zinc-500">{detail}</dd>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 3h6l1 2h5v2H3V5h5l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM6 9h2v9H6V9z"
      />
    </svg>
  );
}

function RefundIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 5V2L7 7l5 5V9a6 6 0 1 1-5.2 3H4.7A8 8 0 1 0 12 5z"
      />
    </svg>
  );
}

function blankPercent(form: HTMLFormElement, name: string): boolean {
  const value = String(new FormData(form).get(name) ?? "").trim().replace(/%$/, "").trim();
  return !/^\d{1,3}(\.\d{1,2})?$/.test(value);
}

function listHref(search: string, status: string, page: number): string {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin?${query}` : "/admin";
}

export function AdminDashboard({ data }: { data: AdminDashboardData }) {
  const [feeMessage, setFeeMessage] = useState<string | null>(null);
  const [poolMessage, setPoolMessage] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<string | null>(data.fixture?.deleteError ?? null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ kind: "delete" | "refund"; bounty: AdminBountyRow } | null>(
    data.fixture?.step === "delete"
      ? { kind: "delete", bounty: data.bounties.rows[0] ?? data.bounties.rows[0] }
      : data.fixture?.step === "refund"
        ? { kind: "refund", bounty: data.bounties.rows.find((row) => row.refundable) ?? data.bounties.rows[0] }
        : null,
  );
  const [busy, setBusy] = useState(false);
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
          feeBalanceUsdc: data.feeOnChain.text,
        }
      : null,
  );
  const [typed, setTyped] = useState("");
  const [withdrawMessage, setWithdrawMessage] = useState<string | null>(null);
  const rows = data.bounties.rows.filter((row) => !hidden.has(row.id));
  const confirmBounty = confirm && rows.some((row) => row.id === confirm.bounty.id) ? confirm : confirm;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
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
            Existing bounties keep the fee and pool stamped at creation. Enter a percent with up to two decimals.
          </p>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (blankPercent(event.currentTarget, "feePercent")) {
                setFeeMessage(FEE_PERCENT_RANGE);
                return;
              }
              void setFeeBpsAction(new FormData(event.currentTarget)).then((result) => {
                setFeeMessage(result.ok ? `Fee is ${result.feePercent}%.` : result.message);
              });
            }}
          >
            <label className="text-sm">
              Fee
              <span className="mt-1 flex items-center gap-1">
                <input
                  name="feePercent"
                  defaultValue={data.feePercent}
                  inputMode="decimal"
                  step="0.01"
                  className="block w-28 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                />
                <span>%</span>
              </span>
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
              if (blankPercent(event.currentTarget, "poolPercent")) {
                setPoolMessage(POOL_PERCENT_RANGE);
                return;
              }
              void setPoolBpsAction(new FormData(event.currentTarget)).then((result) => {
                setPoolMessage(result.ok ? `Pool is ${result.poolPercent}%.` : result.message);
              });
            }}
          >
            <label className="text-sm">
              Pool of post-fee
              <span className="mt-1 flex items-center gap-1">
                <input
                  name="poolPercent"
                  defaultValue={data.poolPercent}
                  inputMode="decimal"
                  step="0.01"
                  className="block w-28 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                />
                <span>%</span>
              </span>
            </label>
            <button className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900" type="submit">
              Save pool
            </button>
          </form>
          {poolMessage ? <p className="mt-2 text-sm">{poolMessage}</p> : null}
        </Card>

        <Card title="Balances">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Tile title="Escrow on-chain" tile={data.escrowOnChain} detail={data.escrowAddress} />
            <Tile title="Escrow liabilities" tile={data.liabilities} detail="Database, view only" />
            <Tile title="Fee on-chain" tile={data.feeOnChain} detail={data.feeAddress} />
            <Tile
              title="Fees earned in DB"
              tile={data.feesEarned}
              detail={data.feesWithdrawn.error ? data.feesWithdrawn.text : `Withdrawn ${data.feesWithdrawn.text}`}
            />
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

      <Card title="Bounties">
        <form className="flex flex-wrap items-end gap-2" action="/admin" method="get">
          <label className="min-w-64 flex-1 text-sm">
            Search title, repo, issue, or id
            <input
              name="q"
              defaultValue={data.bounties.search}
              className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="text-sm">
            Status
            <select
              name="status"
              defaultValue={data.bounties.status}
              className="mt-1 block rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="">All</option>
              {data.statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900" type="submit">
            Filter
          </button>
        </form>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Title</th>
                <th className="py-2 pr-3 font-medium">Repo</th>
                <th className="py-2 pr-3 font-medium">Issue</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">USDC</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="py-4 text-zinc-500" colSpan={6}>
                    No bounties match.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-2 pr-3">
                      <div>{row.title}</div>
                      <div className="font-mono text-xs text-zinc-500">{row.id}</div>
                    </td>
                    <td className="py-2 pr-3">{row.repoFullName}</td>
                    <td className="py-2 pr-3">{row.githubIssueNumber}</td>
                    <td className="py-2 pr-3">{row.status}</td>
                    <td className="py-2 pr-3 font-mono">{row.amountUsdc}</td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        {row.refundable ? (
                          <button
                            type="button"
                            aria-label={`Refund ${row.title}`}
                            className="rounded-md border border-zinc-300 p-2 dark:border-zinc-700"
                            onClick={() => setConfirm({ kind: "refund", bounty: row })}
                          >
                            <RefundIcon />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Delete ${row.title}`}
                          className="rounded-md border border-zinc-300 p-2 dark:border-zinc-700"
                          onClick={() => setConfirm({ kind: "delete", bounty: row })}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
          <p>
            {data.bounties.total} bounties · page {data.bounties.page} of {data.bounties.pageCount}
          </p>
          <div className="flex gap-3">
            {data.bounties.page > 1 ? (
              <a className="underline" href={listHref(data.bounties.search, data.bounties.status, data.bounties.page - 1)}>
                Previous
              </a>
            ) : null}
            {data.bounties.page < data.bounties.pageCount ? (
              <a className="underline" href={listHref(data.bounties.search, data.bounties.status, data.bounties.page + 1)}>
                Next
              </a>
            ) : null}
          </div>
        </div>
        {rowMessage ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{rowMessage}</p> : null}
      </Card>

      {confirmBounty ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-confirm-title"
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h3 id="admin-confirm-title" className="text-lg font-semibold">
              {confirmBounty.kind === "delete" ? "Soft-delete this bounty?" : "Refund this bounty?"}
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {confirmBounty.bounty.title} · {confirmBounty.bounty.repoFullName}#{confirmBounty.bounty.githubIssueNumber}
            </p>
            <p className="mt-2 font-mono text-xs text-zinc-500">{confirmBounty.bounty.id}</p>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              {confirmBounty.kind === "delete"
                ? "It leaves the public board, API, and stats. Paid, cancelled, refunded, and never-funded bounties can be deleted. A bounty that still holds funds stays put."
                : "This uses the existing refund flow. Funds return to the recorded payer. The money flag and the current refund guards still apply."}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                onClick={() => {
                  const current = confirmBounty;
                  if (data.fixture) {
                    if (current.kind === "delete" && data.fixture.deleteError) {
                      setRowMessage(data.fixture.deleteError);
                    } else if (current.kind === "delete") {
                      setHidden((prev) => new Set(prev).add(current.bounty.id));
                      setRowMessage(`Deleted ${current.bounty.id}`);
                    } else {
                      setRowMessage(`Refund started for ${current.bounty.id}`);
                    }
                    setConfirm(null);
                    return;
                  }
                  setBusy(true);
                  const form = new FormData();
                  form.set("bountyId", current.bounty.id);
                  if (current.kind === "delete") {
                    void deleteBountyAction(form).then((result) => {
                      setBusy(false);
                      setConfirm(null);
                      if (!result.ok) {
                        setRowMessage(`${result.error}: ${result.message}`);
                        return;
                      }
                      setHidden((prev) => new Set(prev).add(result.id));
                      setRowMessage(`Deleted ${result.id}`);
                    });
                    return;
                  }
                  void refundBountyAction(form).then((result) => {
                    setBusy(false);
                    setConfirm(null);
                    if (!result.ok) {
                      setRowMessage(`${result.error}: ${result.message}`);
                      return;
                    }
                    setRowMessage(
                      `Refunded ${result.id} · ${result.status}${result.refundTxHash ? ` · ${result.refundTxHash}` : ""}`,
                    );
                  });
                }}
              >
                {confirmBounty.kind === "delete" ? "Delete" : "Refund"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
