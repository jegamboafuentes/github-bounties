import Link from "next/link";
import { requirePageUser } from "@/auth/protect";
import { AppHeader } from "@/components/header";
import { ConnectGitHubButton } from "@/components/connect-github";
import { DisconnectGitHubButton } from "@/components/disconnect-github";
import { WalletForm } from "@/components/wallet-form";
import { signOutToHome } from "@/app/actions/auth";
import { PRODUCT_NAME } from "@/lib/constants";
import { getRuntimeDb } from "@/db/runtime";
import { findGithubLinkByUserId, listReposForUser } from "@/github/persist";
import { missingGitHubAppInstallEnv } from "@/webhooks/env";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await requirePageUser("/settings");
  const query = await searchParams;
  const db = getRuntimeDb();
  const [link, connectedRepos] = await Promise.all([
    findGithubLinkByUserId(user.id, db),
    listReposForUser(user.id, db),
  ]);
  const missingApp = missingGitHubAppInstallEnv();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-6 py-14">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Account</p>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Signed in to {PRODUCT_NAME} with Google. Session user is persisted as{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-800">
              users.google_sub
            </code>
            .
          </p>
        </div>

        <dl className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Display name</dt>
            <dd className="sm:col-span-2 font-medium">{user.display_name}</dd>
          </div>
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Email</dt>
            <dd className="sm:col-span-2">{user.email}</dd>
          </div>
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">google_sub</dt>
            <dd className="sm:col-span-2 break-all font-mono text-sm">{user.google_sub}</dd>
          </div>
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">User id</dt>
            <dd className="sm:col-span-2 break-all font-mono text-sm">{user.id}</dd>
          </div>
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Base wallet</dt>
            <dd className="sm:col-span-2 break-all font-mono text-sm">
              {user.wallet_address ?? <span className="font-sans text-zinc-500">Not set</span>}
            </dd>
          </div>
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">GitHub</dt>
            <dd className="sm:col-span-2">
              {link ? (
                <span className="font-medium">{link.githubLogin}</span>
              ) : (
                <span className="text-zinc-500">Not linked</span>
              )}
            </dd>
          </div>
        </dl>

        {query.notice ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            {query.notice}
          </p>
        ) : null}

        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Payout wallet
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Bring-your-own Base address. Saved on{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-800">
              users.wallet_address
            </code>
            . No custodial wallet.
          </p>
          <WalletForm defaultAddress={user.wallet_address ?? ""} />
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            {link ? "Connected GitHub" : "Connect GitHub"}
          </h2>
          {link ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Linked as{" "}
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {link.githubLogin}
              </span>
              . Merge payouts match this login. Disconnect to Connect a different
              GitHub account. Product login stays Google.
            </p>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Product login stays Google. Connecting installs the GitHub App and stores
              the installation on <code>repos</code>, then links{" "}
              <code>github_links</code> so merge authors can claim payouts.
            </p>
          )}
          {connectedRepos.length > 0 ? (
            <ul className="list-disc pl-5 text-sm text-zinc-700 dark:text-zinc-300">
              {connectedRepos.map((repo) => (
                <li key={repo.id}>
                  {repo.fullName}{" "}
                  <span className="text-zinc-500">
                    (installation {repo.installationId.toString()})
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {missingApp.length > 0 ? (
            <ConnectGitHubButton
              blocked
              missing={missingApp}
              githubLogin={link?.githubLogin}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {link ? <DisconnectGitHubButton githubLogin={link.githubLogin} /> : null}
              <ConnectGitHubButton
                blocked={false}
                missing={[]}
                githubLogin={link?.githubLogin}
              />
            </div>
          )}
          {missingApp.length > 0 && link ? (
            <DisconnectGitHubButton githubLogin={link.githubLogin} />
          ) : null}
          {link ? (
            <p className="text-xs text-zinc-500">
              Disconnect unlinks <code>github_links</code> only. It does not uninstall
              the GitHub App or deactivate repos — those stay until GitHub sends an
              uninstall/suspend webhook.
            </p>
          ) : null}
        </section>

        <form action={signOutToHome}>
          <button
            type="submit"
            className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
          >
            Sign out
          </button>
        </form>

        <p className="text-sm text-zinc-500">
          <Link href="/" className="underline underline-offset-4">
            Back home
          </Link>
          {" · "}
          <Link href="/api/me" className="underline underline-offset-4">
            GET /api/me
          </Link>
        </p>
      </main>
    </div>
  );
}
