"use client";

import { useEffect, useRef, useState } from "react";
import { createApiKeyAction, revokeApiKeyAction, type ApiKeyActionState } from "@/app/actions/api-keys";

export type ApiKeyListItem = {
  id: string;
  name: string;
  prefix: string;
  env: "test" | "live";
  scopes: Array<"read" | "write" | "money">;
  perTxCapUsdc: string;
  dailyCapUsdc: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
};

/**
 * Plaintext lives only in this component's state. It is a text node, not a form
 * field, so a reload cannot restore it from the browser's form data. pagehide
 * blanks the node before the back-forward cache snapshots the page.
 */
function ShownOnceSecret({ token }: { token: string }) {
  const [value, setValue] = useState(token);
  const nodeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    function blank() {
      setValue("");
      if (nodeRef.current) nodeRef.current.textContent = "";
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) blank();
    }
    window.addEventListener("pagehide", blank);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", blank);
      window.removeEventListener("pageshow", onPageShow);
      blank();
    };
  }, []);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* The text stays visible so the user can copy it by hand. */
    }
  }

  if (!value) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-zinc-950 p-3">
      <p ref={nodeRef} className="break-all font-mono text-xs text-emerald-200">
        {value}
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="w-fit rounded-md border border-emerald-700 px-2 py-1 text-xs text-emerald-200"
      >
        Copy
      </button>
    </div>
  );
}

function RevokeKeyButton({ keyId }: { keyId: string }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-red-700 underline-offset-4 hover:underline dark:text-red-400"
      >
        Revoke
      </button>
    );
  }
  return (
    <form action={revokeApiKeyAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="keyId" value={keyId} />
      <button type="submit" className="text-xs font-medium text-red-700 underline-offset-4 hover:underline dark:text-red-400">
        Confirm revoke
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-xs text-zinc-500 underline-offset-4 hover:underline"
      >
        Keep key
      </button>
    </form>
  );
}

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
  const prefix = keyEnv === "live" ? "gb_live_" : "gb_test_";
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(true);
  const [secret, setSecret] = useState<string | null>(null);

  async function onCreate(formData: FormData) {
    setPending(true);
    setSecret(null);
    setMessage(null);
    try {
      const result: ApiKeyActionState = await createApiKeyAction(undefined, formData);
      setOk(result.ok);
      setMessage(result.message ?? null);
      if (result.token) setSecret(result.token);
    } finally {
      setPending(false);
    }
  }

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

      <form action={onCreate} autoComplete="off" className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            name="name"
            required
            maxLength={80}
            autoComplete="off"
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
              autoComplete="off"
              defaultValue={ceilings.perTxUsdc}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Daily cap (USDC)
            <input
              name="dailyCapUsdc"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={ceilings.dailyUsdc}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        </div>
        {message ? (
          <p className={ok ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-red-700 dark:text-red-400"}>
            {message}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Creating…" : "Create API key"}
        </button>
      </form>

      {secret ? <ShownOnceSecret token={secret} /> : null}

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
              Created {key.createdAt}
              {" · "}
              Last used {key.lastUsedAt ?? "never"}
              {key.lastUsedIp ? ` from ${key.lastUsedIp}` : ""}
              {key.revokedAt ? ` · revoked ${key.revokedAt}` : ""}
            </p>
            {key.revokedAt ? null : <RevokeKeyButton keyId={key.id} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
