"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  submitHuggingFacePrAction,
  withdrawSubmissionAction,
  type BountyActionState,
} from "@/app/actions/bounties";
import type { SubmissionView } from "@/bounties/submissions";

const initial: BountyActionState = { ok: true };

export function HfSubmissionsPanel({
  bountyId,
  submissions,
  canSubmit,
  canWithdraw,
  linked,
  signedIn,
  signInHref,
}: {
  bountyId: string;
  submissions: SubmissionView[];
  canSubmit: boolean;
  canWithdraw: boolean;
  linked: boolean;
  signedIn: boolean;
  signInHref: string;
}) {
  const [submitState, submitAction, submitPending] = useActionState(submitHuggingFacePrAction, initial);
  const [withdrawState, withdrawAction, withdrawPending] = useActionState(
    withdrawSubmissionAction,
    initial,
  );
  const submitError = submitState && !submitState.ok ? submitState.message : null;
  const withdrawError = withdrawState && !withdrawState.ok ? withdrawState.message : null;

  return (
    <section
      data-hf-submissions
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Submissions</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          Hunters submit a Hugging Face pull request in this repo. Merging it does not pay out yet.
          Each row stays <span className="font-medium">submitted</span>.
        </p>
      </div>

      {submissions.length === 0 ? (
        <p className="text-zinc-500">No pull requests submitted yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {submissions.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 py-2" data-hf-submission={row.id}>
              <a href={row.prUrl} className="underline underline-offset-4" target="_blank" rel="noreferrer">
                #{row.prNum} · {row.hfAuthor || "unknown"}
              </a>
              <span className="text-xs text-zinc-500" data-hf-submission-status>
                {row.status} · {row.createdAt}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canSubmit ? (
        <form action={submitAction} data-hf-submit className="flex flex-col gap-2">
          <input type="hidden" name="bountyId" value={bountyId} />
          <label className="flex flex-col gap-1">
            <span className="font-medium">Pull request URL</span>
            <input
              name="prUrl"
              type="url"
              required
              placeholder="https://huggingface.co/owner/repo/discussions/12"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <p className="text-xs text-zinc-500">
            Model, dataset, or Space discussion URL with a pull request. It must be open or merged, in
            this repo, and opened by your linked Hugging Face account.
          </p>
          {submitError ? (
            <p role="alert" data-hf-submit-error className="text-sm text-red-600 dark:text-red-400">
              {submitError}
            </p>
          ) : null}
          {submitState?.ok && submitState.message ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">{submitState.message}</p>
          ) : null}
          <button
            type="submit"
            disabled={submitPending}
            className="w-fit rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950"
          >
            {submitPending ? "Submitting…" : "Submit pull request"}
          </button>
        </form>
      ) : null}

      {canWithdraw ? (
        <form action={withdrawAction} data-hf-withdraw className="flex flex-col gap-2">
          <input type="hidden" name="bountyId" value={bountyId} />
          {withdrawError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {withdrawError}
            </p>
          ) : null}
          {withdrawState?.ok && withdrawState.message ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">{withdrawState.message}</p>
          ) : null}
          <button
            type="submit"
            disabled={withdrawPending}
            className="w-fit rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
          >
            {withdrawPending ? "Withdrawing…" : "Withdraw submission"}
          </button>
        </form>
      ) : null}

      {signedIn && !linked ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          <Link href="/settings" className="underline underline-offset-4">
            Connect Hugging Face
          </Link>{" "}
          before submitting a pull request.
        </p>
      ) : null}

      {!signedIn ? (
        <p className="text-zinc-500">
          <Link href={signInHref} className="underline underline-offset-4">
            Sign in
          </Link>{" "}
          to submit a pull request.
        </p>
      ) : null}
    </section>
  );
}
