import Link from "next/link";

export function ConnectGitHubButton({
  blocked,
  missing,
  githubLogin,
}: {
  blocked: boolean;
  missing: string[];
  githubLogin?: string | null;
}) {
  if (blocked) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        <p className="font-medium">GitHub App install is blocked in this environment.</p>
        <p className="mt-2">Missing env (placeholders only in <code>.env.example</code>):</p>
        <ul className="mt-2 list-disc pl-5 font-mono text-xs">
          {missing.map((key) => (
            <li key={key}>{key}</li>
          ))}
        </ul>
        <p className="mt-2">
          See <code>docs/github-app.md</code>. Never paste App secrets into git or chat.
        </p>
      </div>
    );
  }

  return (
    <Link
      href="/api/github/connect"
      className="w-fit rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
    >
      {githubLogin ? "Manage GitHub App install" : "Connect GitHub"}
    </Link>
  );
}
