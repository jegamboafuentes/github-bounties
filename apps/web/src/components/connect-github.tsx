"use client";

import { useState } from "react";

type StubResponse = {
  ok?: boolean;
  stub?: boolean;
  ticket?: string;
  message?: string;
  error?: string;
};

export function ConnectGitHubButton() {
  const [result, setResult] = useState<StubResponse | null>(null);
  const [pending, setPending] = useState(false);

  async function onConnect() {
    setPending(true);
    try {
      const res = await fetch("/api/github/connect", { method: "POST" });
      const body = (await res.json()) as StubResponse;
      setResult(body);
    } catch {
      setResult({ error: "request_failed", message: "Could not reach the Connect GitHub stub." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onConnect}
        disabled={pending}
        className="w-fit rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {pending ? "Connecting…" : "Connect GitHub"}
      </button>
      {result ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {result.message ?? result.error} {result.ticket ? `(${result.ticket})` : ""}
        </p>
      ) : (
        <p className="text-sm text-zinc-500">
          Stub for V1-3. Does not install the GitHub App or write <code>github_links</code>.
        </p>
      )}
    </div>
  );
}
