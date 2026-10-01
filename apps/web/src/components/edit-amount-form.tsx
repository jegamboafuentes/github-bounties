"use client";

import { useActionState, useState } from "react";
import { updateBountyAmountAction, type BountyActionState } from "@/app/actions/bounties";
import { normalizeBountyAmountUsdc } from "@/bounties/amount";
import { isBountyError } from "@/bounties/errors";
import { formatUsdc } from "@/bounties/display";

const initial: BountyActionState = { ok: true };

export function EditAmountForm({
  bountyId,
  amountUsdc,
}: {
  bountyId: string;
  amountUsdc: string;
}) {
  const [state, action, pending] = useActionState(updateBountyAmountAction, initial);
  const [value, setValue] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const errorMessage = clientError ?? (state && !state.ok ? state.message ?? "Enter a valid USDC amount." : null);

  return (
    <form
      action={action}
      data-edit-amount
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      onSubmit={(event) => {
        const next = value.trim();
        if (!next) {
          event.preventDefault();
          setClientError("Enter a USDC amount greater than 0.");
          return;
        }
        try {
          const normalized = normalizeBountyAmountUsdc(next);
          if (normalized === amountUsdc) {
            event.preventDefault();
            setClientError(`The amount is already ${normalized} USDC.`);
          } else {
            setClientError(null);
          }
        } catch (err) {
          event.preventDefault();
          setClientError(
            isBountyError(err) ? err.message : "Enter a valid USDC amount (up to 6 decimal places).",
          );
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Edit amount</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Current face {formatUsdc(amountUsdc)} USDC. Same limits as posting a bounty. You can change
          it until the first payment. Hunters can already be working.
        </p>
      </div>
      <input type="hidden" name="bountyId" value={bountyId} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">New face (USDC)</span>
        <input
          name="amountUsdc"
          type="text"
          inputMode="decimal"
          required
          aria-invalid={errorMessage ? true : undefined}
          placeholder={formatUsdc(amountUsdc)}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (clientError) setClientError(null);
          }}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
      {errorMessage ? (
        <p role="alert" data-edit-amount-error className="text-sm text-red-600 dark:text-red-400">
          {errorMessage}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{state.message}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {pending ? "Saving…" : "Edit amount"}
      </button>
    </form>
  );
}
