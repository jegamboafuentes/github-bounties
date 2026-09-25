"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
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

type ShownSecret = { keyId: string; token: string; epoch: number };

/**
 * Form actions run inside a React transition. A `setSecret(null)` at the start
 * of the action is flushed together with the later `setSecret(next)`, so a
 * child that did `useState(token)` never unmounted and kept painting the first
 * secret while `revalidatePath` refreshed the list. That fiber is what the
 * back-forward cache snapshots, which is why F5 still showed s1 and a client
 * navigation to /board (a new mount) did not. The plaintext stays in this
 * state only, keyed by the created key id.
 */
let issuedEpoch = 0;
let discardedThrough = 0;

function takeEpoch(): number {
  issuedEpoch += 1;
  return issuedEpoch;
}

function discardShownSecrets(): void {
  discardedThrough = issuedEpoch;
}

function secretIsLive(epoch: number): boolean {
  return epoch > discardedThrough;
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

export type ApiKeysCardProps = {
  keys: ApiKeyListItem[];
  ceilings: { perTxUsdc: string; dailyUsdc: string };
  keyEnv: "test" | "live";
  moneyEligible: boolean;
  walletSet: boolean;
  githubLinked: boolean;
};

export function ApiKeysCard(props: ApiKeysCardProps) {
  const router = useRouter();
  return (
    <ApiKeysPanel
      {...props}
      createKey={createApiKeyAction}
      refresh={() => router.refresh()}
    />
  );
}

export function ApiKeysPanel({
  keys,
  ceilings,
  keyEnv,
  moneyEligible,
  walletSet,
  githubLinked,
  createKey,
  refresh,
}: ApiKeysCardProps & {
  createKey: (formData: FormData) => Promise<ApiKeyActionState>;
  refresh: () => void;
}) {
  const prefix = keyEnv === "live" ? "gb_live_" : "gb_test_";
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(true);
  const [shown, setShown] = useState<ShownSecret | null>(null);
  const secretNode = useRef<HTMLParagraphElement>(null);
  const live = shown && secretIsLive(shown.epoch) ? shown : null;

  useEffect(() => {
    function blankDom() {
      if (secretNode.current) secretNode.current.textContent = "";
    }
    function discard() {
      discardShownSecrets();
      blankDom();
      try {
        flushSync(() => setShown(null));
      } catch {
        setShown(null);
      }
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) discard();
    }
    window.addEventListener("pagehide", discard);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", discard);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setPending(true);
    setShown(null);
    setMessage(null);
    try {
      const result = await createKey(formData);
      setOk(result.ok);
      setMessage(result.message ?? null);
      if (result.ok && result.token && result.keyId) {
        const keyId = result.keyId;
        const token = result.token;
        const epoch = takeEpoch();
        setShown(() => (secretIsLive(epoch) ? { keyId, token, epoch } : null));
      }
      if (result.ok) refresh();
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

      <form onSubmit={(event) => void onSubmit(event)} autoComplete="off" className="flex flex-col gap-3">
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
            <input type="checkbox" name="scopeRead" value="1" defaultChecked autoComplete="off" />
            read
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="scopeWrite" value="1" autoComplete="off" />
            write
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="scopeMoney" value="1" disabled={!moneyEligible} autoComplete="off" />
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

      {live ? (
        <div key={live.keyId} className="flex flex-col gap-2 rounded-lg bg-zinc-950 p-3">
          <p ref={secretNode} className="break-all font-mono text-xs text-emerald-200">
            {live.token}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                const token = live.token;
                void navigator.clipboard.writeText(token).catch(() => {
                  /* The text stays visible so the user can copy it by hand. */
                });
              }}
              className="w-fit rounded-md border border-emerald-700 px-2 py-1 text-xs text-emerald-200"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setShown(null)}
              className="w-fit rounded-md border border-zinc-600 px-2 py-1 text-xs text-zinc-200"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

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
