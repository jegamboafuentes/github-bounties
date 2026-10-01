import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium text-zinc-500">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Not found</h1>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">That page is not available.</p>
      <Link href="/" className="mt-6 text-sm underline underline-offset-4">
        Home
      </Link>
    </main>
  );
}
