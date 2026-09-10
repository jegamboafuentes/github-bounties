import Link from "next/link";
import { getOptionalSession } from "@/auth";
import { signOutToHome } from "@/app/actions/auth";
import { PRODUCT_NAME } from "@/lib/constants";

export async function AppHeader() {
  const session = await getOptionalSession();
  const signedIn = Boolean(session?.user?.id);

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          {PRODUCT_NAME}
        </Link>
        <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/board" className="underline-offset-4 hover:underline">
            Board
          </Link>
          <Link href="/bounties/new" className="underline-offset-4 hover:underline">
            Post
          </Link>
          <Link href="/api/health" className="underline-offset-4 hover:underline">
            Health
          </Link>
          {signedIn ? (
            <>
              <Link href="/settings" className="underline-offset-4 hover:underline">
                Settings
              </Link>
              <form action={signOutToHome}>
                <button type="submit" className="underline-offset-4 hover:underline">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/signin" className="underline-offset-4 hover:underline">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
