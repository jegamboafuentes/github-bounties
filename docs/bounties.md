# Bounty post, board, and parallel hunt (V1-4 / V2-4)

Official name: **GitHub Bounties**. Poster creates a bounty from a GitHub issue URL. The board lists bounties. Hunters hunt in **parallel**. Optional **Working on this** is a non-exclusive signal (many hunters per bounty). Exclusive 72h claim-lock is **retired** (V2-4). Residual V1 `claim_locks` drain on board/detail read and via `GET|POST /api/jobs/expire-claim-locks`.

**Working on this does not move money.** Merge is still truth: the winner is the author of the merged pull request that closes funded issue `#N` (V1-3 `claims.status=eligible`). Pool members are frozen at that merge (ADR 0003).

This is not Lightning Bounties / LB1. Escrow lock / 2% settlement is V1-5 ([docs/escrow.md](escrow.md)). Signals still do not move USDC.

## Product locks

| Item | Value |
| --- | --- |
| Hunt | parallel; optional non-exclusive `work_signals` |
| Exclusive claim-lock | **sunset** (V2-4). Do not acquire new `claim_locks`. |
| Fund | escrow lock `pending_fund` → `funded` (CDP or documented mock) |
| Auth | Google session for post / fund-lock / signal / claim / cancel |
| Repo | must be App-connected (`repos.is_active`) |

## Status flow

The create form is the **draft**. Schema has no `draft` status. Submit writes `pending_fund`, then:

`pending_fund` → **escrow lock** → `funded` → (optional signals; no exclusive lock) → winning merge → settle

Residual `claim_locked` rows drain to `funded` on read. Money: `funded` → eligible winner claims → `settled` / `settled_partial` (board: **Completed (paid)**), or cancel / `expires_at` → `refunded` (bounty `cancelled` / `expired`). See [escrow.md](escrow.md) and [claims.md](claims.md).

## Surfaces

| URL | Auth | Role |
| --- | --- | --- |
| `/board` | public | List + filter by repo / status / complexity / language. Ready Gemini intel shows S/M/L + stack badges (hidden when missing). Poster and paid hunter GitHub avatars when a login is present (`avatars.githubusercontent.com/{login}`) |
| `GET /api/stats` | public | Versioned platform aggregates (`schemaVersion`). Homepage consumes the same helper. See [stats.md](stats.md) |
| `/settings` | Google session | GitHub connection status (connected vs not). Payout wallet: WalletConnect (same Reown project id as fund) or Advanced paste. Pool members are paid to this wallet when settle runs. |
| `/bounties/new` | Google session | Create from issue URL. GitHub **Connected** vs **Not connected** only (no connected-repo dump). Face chips `$1 / $5 / $10 / $50 / $100` + custom |
| `/bounties/[id]` | public read; Google for actions | Full GitHub issue body (sanitized markdown), Gemini intelligence card (AI estimates; degrades without `GEMINI_API_KEY`), escrow lock (WalletConnect / Pay face + Advanced paste-hash), Working on this, pool roster, payout breakdown, winner Claim (BYO Base), cancel/refund |
| `GET\|POST /api/jobs/expire-claim-locks` | optional `CRON_SECRET` | Drains residual exclusive locks **and** `expires_at` bounty refunds |

CLI (same function): `cd apps/web && npm run expire-locks`

Expiry **does not advertise** exclusive lock. It force-releases / expires leftover `claim_locks.status=active` and restores `claim_locked` bounties to `funded`. `bounties.expires_at` refunds are unchanged. Board and detail also drain on read.

## GitHub comment / label

V1 best-effort `bounty-claimed` after exclusive lock is not started from V2-4 UI. Signals do not add an exclusive label.

Hunter payout after merge: [claims.md](claims.md). Pool roster + split: ADR 0003 / V2-4 UI.

## Out of scope

- WalletConnect + amount chips redesign (V1.5 polish)
- Hosted checkout (blocked — ADR 0001 fee-skim open Q)
- V2-5 live multi-browser dogfood (Enrique; runbook in [staging-e2e.md](staging-e2e.md))

## Secrets

Do not commit `DATABASE_URL`, Google OAuth secrets, GitHub App secrets, `GEMINI_API_KEY`, or `CRON_SECRET`. Empty placeholders only in `.env.example`.

`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is a **public** Reown Cloud project id (not SM). Ops must set it on Cloud Run for the WalletConnect QR button. See [docs/spikes/v15-fund-walletconnect.md](spikes/v15-fund-walletconnect.md).

`GEMINI_API_KEY` is server-only (V3-0 intelligence). Never `NEXT_PUBLIC_*`. Optional on DEV; the bounty page degrades the intelligence card when unset. See [bounty-intelligence.md](bounty-intelligence.md).
