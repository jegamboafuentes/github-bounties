import Link from "next/link";
import { requirePageUser } from "@/auth/protect";
import { AppHeader } from "@/components/header";
import { CreateBountyForm } from "@/components/create-bounty-form";
import { listReposForUser } from "@/github/persist";
import { getRuntimeDb } from "@/db/runtime";

export const dynamic = "force-dynamic";

export default async function NewBountyPage() {
  const user = await requirePageUser("/bounties/new");
  let repos: Awaited<ReturnType<typeof listReposForUser>> = [];
  try {
    repos = await listReposForUser(user.id, getRuntimeDb());
  } catch {
    repos = [];
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-6 py-14">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">V1-4</p>
          <h1 className="text-3xl font-semibold tracking-tight">Post a bounty</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Paste a GitHub issue URL for an App-connected repo. Google session required.
            Claim-lock later is coordination only — merge is still truth.
          </p>
        </div>

        {repos.length > 0 ? (
          <section className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Your connected repos
            </h2>
            <ul className="mt-2 list-disc pl-5">
              {repos.map((repo) => (
                <li key={repo.id}>{repo.fullName}</li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-sm text-zinc-500">
            No repos connected yet.{" "}
            <Link href="/settings" className="underline underline-offset-4">
              Connect GitHub
            </Link>{" "}
            first, or post against any already-connected repo.
          </p>
        )}

        <CreateBountyForm />

        <p className="text-sm text-zinc-500">
          <Link href="/board" className="underline underline-offset-4">
            Back to board
          </Link>
        </p>
      </main>
    </div>
  );
}
