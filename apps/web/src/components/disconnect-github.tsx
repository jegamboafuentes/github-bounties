"use client";

import { useFormStatus } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";
import { disconnectGitHubAction } from "@/app/actions/github";

function ConfirmDisconnectSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500"
    >
      {pending ? "Disconnecting…" : "Disconnect"}
    </button>
  );
}

export function DisconnectGitHubButton({ githubLogin }: { githubLogin: string }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
      >
        Disconnect
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto w-[min(100%,28rem)] rounded-xl border border-zinc-200 bg-white p-5 text-zinc-950 shadow-xl backdrop:bg-zinc-950/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <form action={disconnectGitHubAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h3 id={titleId} className="text-lg font-semibold tracking-tight">
              Disconnect GitHub?
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Unlink <span className="font-medium text-zinc-900 dark:text-zinc-100">{githubLogin}</span>{" "}
              from this Google account so you can Connect a different GitHub login.
              Your Google session, bounties, and claims stay. The GitHub App install
              on repos is not revoked.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ConfirmDisconnectSubmit />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
