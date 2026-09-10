"use client";

import { useActionState } from "react";
import { createBountyAction, type BountyActionState } from "@/app/actions/bounties";
import { FUND_LOCK_COPY, LOCK_NOT_MONEY_COPY } from "@/bounties/display";

const initial: BountyActionState = { ok: true };

export function CreateBountyForm() {
  const [state, action, pending] = useActionState(createBountyAction, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">GitHub issue URL</span>
        <input
          name="issueUrl"
          type="url"
          required
          placeholder="https://github.com/owner/repo/issues/123"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Face amount (USDC)</span>
        <input
          name="amountUsdc"
          type="text"
          required
          inputMode="decimal"
          placeholder="25"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Submit stores <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">pending_fund</code>.
        The form is the draft — the schema has no draft status. {FUND_LOCK_COPY}
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{LOCK_NOT_MONEY_COPY}</p>
      {state && !state.ok ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {pending ? "Creating…" : "Create bounty"}
      </button>
    </form>
  );
}
