import Link from "next/link";
import { WORKING_ON_THIS_COPY } from "@/bounties";
import type { WorkSignalView } from "@/bounties/signals";
import { GitHubAvatar } from "@/components/github-avatar";

export function WorkSignalsPanel({
  bountyId,
  signals,
  viewerUserId,
  canSignal,
  signedIn,
  signInHref,
  signalAction,
  clearAction,
}: {
  bountyId: string;
  signals: WorkSignalView[];
  viewerUserId?: string | null;
  canSignal: boolean;
  signedIn: boolean;
  signInHref: string;
  signalAction: (formData: FormData) => void | Promise<void>;
  clearAction: (formData: FormData) => void | Promise<void>;
}) {
  const viewerSignaled = Boolean(viewerUserId && signals.some((row) => row.userId === viewerUserId));

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Working on this
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{WORKING_ON_THIS_COPY}</p>
      </div>

      {signals.length === 0 ? (
        <p className="text-sm text-zinc-500">No hunters have signaled yet. Parallel hunt is open.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {signals.map((row) => (
            <li key={row.id} className="flex items-center gap-2 text-sm">
              <GitHubAvatar login={row.githubLogin} size={20} />
              <span>{row.hunterLabel}</span>
            </li>
          ))}
        </ul>
      )}

      {canSignal && !viewerSignaled ? (
        <form action={signalAction}>
          <input type="hidden" name="bountyId" value={bountyId} />
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Working on this
          </button>
        </form>
      ) : null}

      {canSignal && viewerSignaled ? (
        <form action={clearAction}>
          <input type="hidden" name="bountyId" value={bountyId} />
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
          >
            Clear signal
          </button>
        </form>
      ) : null}

      {!signedIn ? (
        <p className="text-sm text-zinc-500">
          <Link href={signInHref} className="underline underline-offset-4">
            Sign in with Google
          </Link>{" "}
          to signal Working on this. Not exclusive.
        </p>
      ) : null}
    </section>
  );
}
