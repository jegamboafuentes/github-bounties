# Bounty post, board, and 72h claim-lock (V1-4)

Official name: **GitHub Bounties**. Poster creates a bounty from a GitHub issue URL. The board lists bounties. Hunters take an exclusive **72-hour** claim-lock with a visible expiry.

**Claim-lock is coordination only. It does not move money.** Merge is still truth: the winner is the author of the merged pull request that closes funded issue `#N` (V1-3 `claims.status=eligible`).

This is not Lightning Bounties / LB1. Escrow lock / 2% settlement is V1-5 ([docs/escrow.md](escrow.md)). Claim-lock still does not move USDC.

## Product locks

| Item | Value |
| --- | --- |
| Claim-lock | exclusive **72h** (`CLAIM_LOCK_HOURS`) |
| Active locks | one per bounty (unique index on `claim_locks` where `status=active`) |
| Fund | escrow lock `pending_fund` → `funded` (CDP or documented mock) |
| Auth | Google session for post / fund-lock / claim / release / cancel |
| Repo | must be App-connected (`repos.is_active`) |

## Status flow

The create form is the **draft**. Schema has no `draft` status. Submit writes `pending_fund`, then:

`pending_fund` → **escrow lock** → `funded` → **claim-lock** → `claim_locked` → release or lock-expiry → `funded`

Money: `funded` → settle → `settled` / `settled_partial`, or cancel / `expires_at` → `refunded` (bounty `cancelled` / `expired`). See [escrow.md](escrow.md).

## Surfaces

| URL | Auth | Role |
| --- | --- | --- |
| `/board` | public | List + filter by repo / status. Shows **Claimed by X until …** when a lock is active |
| `/bounties/new` | Google session | Create from issue URL |
| `/bounties/[id]` | public read; Google for actions | Escrow lock, claim, early release, poster force-release, cancel/refund |
| `GET\|POST /api/jobs/expire-claim-locks` | optional `CRON_SECRET` | Cron-friendly expiry |

CLI (same function): `cd apps/web && npm run expire-locks`

Expiry sets overdue `claim_locks.status=expired` and restores `claim_locked` bounties to `funded` when that is still appropriate. Board and claim paths also run expiry so captions stay current.

## GitHub comment / label

After a successful lock, the app **best-effort** comments on the issue and adds label `bounty-claimed` when an installation token is available. Missing App env or GitHub errors do **not** roll back the lock.

## Out of scope

- Participation pool (V2)
- Payout claim UI polish (V1-6)
- Hosted checkout (blocked — ADR 0001 fee-skim open Q)

## Secrets

Do not commit `DATABASE_URL`, Google OAuth secrets, GitHub App secrets, or `CRON_SECRET`. Empty placeholders only in `.env.example`.
