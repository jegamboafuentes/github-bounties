import Link from "next/link";
import { AppHeader } from "@/components/header";
import type { GitHubCompleteResult } from "@/github/complete";

export function GitHubCompleteView({
  title,
  result,
}: {
  title: string;
  result: GitHubCompleteResult;
}) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-6 py-14">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">V1-3</p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {result.ok ? (
          <>
            <p className="text-zinc-600 dark:text-zinc-400">
              {result.linked
                ? `GitHub account ${result.githubLogin ?? ""} is linked to your Google user.`
                : "GitHub App installation confirmed. Link your GitHub user to finish Connect."}
            </p>
            {result.repos.length > 0 ? (
              <ul className="list-disc pl-5 text-sm">
                {result.repos.map((repo) => (
                  <li key={repo.githubRepoId}>{repo.fullName}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No repositories returned for this installation.</p>
            )}
          </>
        ) : (
          <p className="text-sm text-red-600 dark:text-red-400">{result.message}</p>
        )}
        <p className="text-sm text-zinc-500">
          <Link href="/settings" className="underline underline-offset-4">
            Back to settings
          </Link>
        </p>
      </main>
    </div>
  );
}
