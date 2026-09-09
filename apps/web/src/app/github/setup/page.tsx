import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageUser } from "@/auth/protect";
import { AppHeader } from "@/components/header";
import { completeGitHubAppReturn } from "@/github/complete";
import { missingGitHubAppInstallEnv } from "@/webhooks/env";
import { GitHubCompleteView } from "@/components/github-complete";

export const dynamic = "force-dynamic";

export default async function GitHubSetupPage({
  searchParams,
}: {
  searchParams: Promise<{
    installation_id?: string;
    setup_action?: string;
    state?: string;
    code?: string;
  }>;
}) {
  const params = await searchParams;
  const callback = queryPath("/github/setup", params);
  const user = await requirePageUser(callback);
  const missing = missingGitHubAppInstallEnv();
  if (missing.length > 0) {
    return (
      <GitHubBlockedPage
        title="GitHub App setup"
        missing={missing}
      />
    );
  }

  const result = await completeGitHubAppReturn({
    userId: user.id,
    state: params.state,
    installationId: params.installation_id,
    setupAction: params.setup_action,
    code: params.code,
  });

  if (result.ok && result.next === "oauth" && result.oauthUrl) {
    redirect(result.oauthUrl);
  }

  return (
    <GitHubCompleteView
      title="GitHub App setup"
      result={result}
    />
  );
}

function queryPath(
  pathname: string,
  params: Record<string, string | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function GitHubBlockedPage({ title, missing }: { title: string; missing: string[] }) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-6 py-14">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          GitHub App credentials are unset in this environment. Signature and
          install confirmation stay fail-closed. See <code>docs/github-app.md</code>.
        </p>
        <ul className="list-disc pl-5 font-mono text-xs">
          {missing.map((key) => (
            <li key={key}>{key}</li>
          ))}
        </ul>
        <p className="text-sm text-zinc-500">
          <Link href="/settings" className="underline underline-offset-4">
            Back to settings
          </Link>
        </p>
      </main>
    </div>
  );
}
