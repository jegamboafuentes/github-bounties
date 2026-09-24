"use client";

import { useActionState } from "react";
import { createApiKeyAction, revokeApiKeyAction, type ApiKeyActionState } from "@/app/actions/api-keys";

export type ApiKeyListItem = {
  id: string;
  name: string;
  prefix: string;
  env: "test" | "live";
  scopes: Array<"read" | "write" | "money">;
  perTxCapUsdc: string;
  dailyCapUsdc: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
};

const initial: ApiKeyActionState = { ok: true };

export function ApiKeysCard({
  keys,
  ceilings,
  keyEnv,
  moneyEligible,
  walletSet,
  githubLinked,
}: {
  keys: ApiKeyListItem[];
  ceilings: { perTxUsdc: string; dailyUsdc: string };
  keyEnv: "test" | "live";
  moneyEligible: boolean;
  walletSet: boolean;
  githubLinked: boolean;
}) {
  const [state, action, pending] = useActionState(createApiKeyAction, initial);
  const prefix = keyEnv === "live" ? "gb_live_" : "gb_test_";

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">API keys</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Keys belong to this Google account. Format <code>{prefix}…</code>, shown once, stored as an
          HMAC. Scopes are read, write, and money. Money needs a saved payout wallet and a linked
          GitHub account. Caps start at {ceilings.perTxUsdc} USDC per payment and {ceilings.dailyUsdc}{" "}
          USDC per UTC day. You can lower them here. Raising them is an admin change.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            name="name"
            required
            maxLength={80}
            placeholder="Cursor agent"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Scopes</legend>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="scopeRead" value="1" defaultChecked />
            read
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="scopeWrite" value="1" />
            write
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="scopeMoney" value="1" disabled={!moneyEligible} />
            money
          </label>
        </fieldset>
        {moneyEligible ? null : (
          <p className="text-xs text-zinc-500">
            Money is off until {walletSet ? "GitHub is linked" : githubLinked ? "a payout wallet is saved" : "a payout wallet is saved and GitHub is linked"}.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Per-transaction cap (USDC)
            <input
              name="perTxCapUsdc"
              inputMode="decimal"
              defaultValue={ceilings.perTxUsdc}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Daily cap (USDC)
            <input
              name="dailyCapUsdc"
              inputMode="decimal"
              defaultValue={ceilings.dailyUsdc}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        </div>
        {state.message ? (
          <p className={state.ok ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-red-700 dark:text-red-400"}>
            {state.message}
          </p>
        ) : null}
        {state.token ? (
          <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-emerald-200">{state.token}</pre>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Creating…" : "Create API key"}
        </button>
      </form>

      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {keys.length === 0 ? <li className="py-2 text-sm text-zinc-500">No keys yet.</li> : null}
        {keys.map((key) => (
          <li key={key.id} className="flex flex-col gap-1 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{key.name}</span>
              <code className="text-xs">{key.prefix}…</code>
            </div>
            <p className="text-xs text-zinc-500">
              {key.env} · {key.scopes.join(", ") || "no scopes"} · cap {key.perTxCapUsdc} / {key.dailyCapUsdc} USDC
            </p>
            <p className="text-xs text-zinc-500">
              Last used {key.lastUsedAt ?? "never"}
              {key.lastUsedIp ? ` from ${key.lastUsedIp}` : ""}
              {key.revokedAt ? ` · revoked ${key.revokedAt}` : ""}
            </p>
            {key.revokedAt ? null : (
              <form action={revokeApiKeyAction}>
                <input type="hidden" name="keyId" value={key.id} />
                <button type="submit" className="text-xs text-red-700 underline-offset-4 hover:underline dark:text-red-400">
                  Revoke
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
