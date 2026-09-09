import Link from "next/link";
import { redirect } from "next/navigation";
import { getOptionalSession } from "@/auth";
import { missingLoginEnv } from "@/auth/env";
import { signInWithGoogle } from "@/app/actions/auth";
import { AppHeader } from "@/components/header";
import { PRODUCT_NAME } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;
  const callbackUrl =
    params.callbackUrl && params.callbackUrl.startsWith("/") ? params.callbackUrl : "/settings";
  const session = await getOptionalSession();
  if (session?.user?.id) {
    redirect(callbackUrl);
  }

  const missing = missingLoginEnv();
  const blocked = missing.length > 0;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-14">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">V1-2</p>
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {PRODUCT_NAME} uses <strong>Google</strong> for app identity. The GitHub App is
          repo authority (install + webhooks) — not a login provider.
        </p>
        {blocked ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-medium">Google Sign-In is blocked in this environment.</p>
            <p className="mt-2">Missing env (placeholders only in <code>.env.example</code>):</p>
            <ul className="mt-2 list-disc pl-5 font-mono text-xs">
              {missing.map((key) => (
                <li key={key}>{key}</li>
              ))}
            </ul>
            <p className="mt-3">
              Copy <code>apps/web/.env.example</code> to <code>apps/web/.env</code> and follow{" "}
              <code>docs/google-signin.md</code>. Never paste real OAuth secrets into git or chat.
            </p>
          </div>
        ) : (
          <form
            action={async () => {
              "use server";
              await signInWithGoogle(callbackUrl);
            }}
          >
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Continue with Google
            </button>
          </form>
        )}
        {params.error ? (
          <p className="text-sm text-red-600 dark:text-red-400">Sign-in error: {params.error}</p>
        ) : null}
        <p className="text-sm text-zinc-500">
          <Link href="/" className="underline underline-offset-4">
            Back home
          </Link>
        </p>
      </main>
    </div>
  );
}
