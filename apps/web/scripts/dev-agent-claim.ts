/**
 * DEV-only walkthrough: claim a winner share, a pool share, or refund a
 * funded bounty over the public API. Not part of CI. The body never includes
 * an address. Claims pay the wallet saved for the key owner. Refunds pay the
 * recorded on-chain payer.
 *
 *   cd apps/web
 *   GB_API_KEY=gb_test_... BOUNTY_ID=... KIND=winner \
 *     npx tsx scripts/dev-agent-claim.ts
 *
 * KIND is winner, pool, or refund. Needs a money-scope DEV key, a saved
 * payout wallet, and a linked GitHub login that matches the winner or the
 * caller's own pool row. API_MONEY_ENABLED stays on for base-sepolia.
 */
const base = (process.env.PUBLIC_BASE_URL ?? "https://dev.githubbounties.xyz").replace(/\/$/, "");
const apiKey = process.env.GB_API_KEY?.trim() ?? "";
const bountyId = process.env.BOUNTY_ID?.trim() ?? "";
const kind = (process.env.KIND?.trim() || "winner").toLowerCase();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function api(path: string, init: RequestInit = {}): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function main() {
  if (!apiKey.startsWith("gb_test_")) fail("Set GB_API_KEY to a DEV gb_test_ key.");
  if (!/^[0-9a-f-]{36}$/i.test(bountyId)) fail("Set BOUNTY_ID to a bounty UUID.");
  if (kind !== "winner" && kind !== "pool" && kind !== "refund") {
    fail("KIND must be winner, pool, or refund.");
  }

  const idempotencyKey = `dev-agent-${kind}-${bountyId}`;
  const path = kind === "refund" ? `/api/v1/bounties/${bountyId}/refund` : `/api/v1/bounties/${bountyId}/claim`;
  const body = kind === "refund" ? "{}" : JSON.stringify({ kind });
  const result = await api(path, {
    method: "POST",
    body,
    headers: { "idempotency-key": idempotencyKey },
  });
  console.log(kind, result.status, result.json);
  if (result.status !== 200) fail(`${kind} did not return 200.`);

  const replay = await api(path, {
    method: "POST",
    body,
    headers: { "idempotency-key": idempotencyKey },
  });
  console.log("replay", replay.status, replay.json);
  if (JSON.stringify(replay.json) !== JSON.stringify(result.json)) {
    fail("Replay body did not match the first response.");
  }

  const status = await api(`/api/v1/bounties/${bountyId}/claims`);
  console.log("claims", status.status, status.json);
  const mine = await api("/api/v1/me/claims");
  console.log("me/claims", mine.status, mine.json);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
