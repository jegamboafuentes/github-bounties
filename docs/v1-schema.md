# V1 domain schema (GitHub Bounties)

Contract for tickets **V1-2…V1-6**. Source of truth: [`apps/web/src/db/schema.ts`](../apps/web/src/db/schema.ts) + versioned SQL under [`apps/web/drizzle/`](../apps/web/drizzle/).

**ORM:** Drizzle (SQL-first migrations, no Prisma client runtime).

This is not Lightning Bounties / LB1. Winner later: author of the merged PR that closes funded issue `#N`. Exclusive 72h claim-lock is **retired** (V2-4); residual `claim_locks` drain on read. Optional `work_signals` are not exclusive and **do not move USDC**. Fee is **2%** (`fee_bps = 200`) at settlement.

## Tables

| Table | Role |
| --- | --- |
| `users` | Google identity (`google_sub` unique), email, display name, nullable BYO Base `wallet_address` (V1-6) |
| `github_links` | One GitHub account per user (`github_id`, `github_login`). Unique on `user_id` and `github_id`. Settings Disconnect deletes this row only. |
| `repos` | Connected repo (`github_repo_id`, `full_name`, `installation_id`, `connected_by_user_id`, `is_active`) |
| `bounties` | Issue bounty; `amount_usdc`, `currency` default USDC, `chain` default `base` |
| `claim_locks` | Legacy exclusive lock (V2-4 sunset). Residual `active` rows drain to `released`/`expired`; unique one-active-per-bounty index remains |
| `escrows` | 1:1 with bounty; fund / payout / fee / refund tx hashes + idempotency key (V1-5); last Lock/settle `fail_code` / `fail_reason` |
| `claims` | Winner-only `eligible` \| `paid` \| `rejected` \| `disputed`; PR + merge + payout fields. Pool members are **not** claims rows. |
| `fee_ledger` | `face_usdc`, `fee_usdc`, `fee_bps` default **200**, `settled_at` |
| `pool_participants` | V2-1 frozen roster. Unique `(bounty_id, github_id)`. `role` ∈ `winner \| pool \| overflow \| excluded_poster \| excluded_bot`. Nullable `user_id`. Equal `share_usdc` (0 for overflow/excluded). |
| `allocation_ledger` | V2-1 one row per intended chain movement. `kind` ∈ `FEE_OUT \| WINNER_PAYOUT \| POOL_PAYOUT`. Unique `(bounty_id, kind, participant_id)` (`NULLS NOT DISTINCT`) and unique `idempotency_key`. |
| `work_signals` | V2-1 non-exclusive “working on this”. Many rows per bounty / `(bounty_id, user_id)`. **No** exclusive unique index. Not a money row. |
| `bounty_intelligence` | V3-0 Gemini cache keyed by `bounty_id` (repo about, stack, complexity S/M/L, source fingerprint, `generated_at`) |
| `webhook_deliveries` | GitHub `X-GitHub-Delivery` GUID primary key (V1-3 idempotency); `claim_results` JSON + winner/PR/repo for skip reasons |

`bounties.participation_pool_bps` default **1500 = 15% of post-fee**, not of face (ADR 0003 / V2-1). `participation_pool_usdc` is filled at V2-3 settle when `N` is known. `escrows.payout_tx_hash` remains the **winner** hash for V1 readers; pool hashes live on `allocation_ledger` / `pool_participants`. `bounties.issue_body_synced_at` records the last GitHub issue-body sync (V3-0).

## Status enums (ADR 0001 mapping)

| `bounty_status` | ADR money/coordination |
| --- | --- |
| `pending_fund` | Funding |
| `funded` | Open |
| `claim_locked` | ClaimLocked |
| `settling` | Settling |
| `settled` | Settled |
| `settled_partial` | SettledPartial |
| `refunding` | Refunding |
| `refunded` | Refunded |
| `void` | Void |
| `cancelled` / `expired` | product terminals (refund path) |

`escrow_status`: `pending` → `funded` (locked) → `settling` / `refunding` → `settled` (released) / `settled_partial` / `refunded` / `failed`.

`claim_lock_status`: `active` \| `expired` \| `released` \| `consumed`.

## Indexes / invariants

- Unique **one active bounty** per `(repo_id, github_issue_number)` while status is `pending_fund`, `funded`, `claim_locked`, `settling`, `settled_partial`, or `refunding`.
- Unique **one active claim-lock** per `bounty_id` (index kept; V2-4 does not acquire new locks; drain on read).
- Unique `(bounty_id, github_id)` on `pool_participants`.
- Unique `(bounty_id, kind, participant_id)` (`NULLS NOT DISTINCT` unique constraint) and unique `idempotency_key` on `allocation_ledger`.
- `work_signals` has **no** exclusive unique index.
- Unique escrow per `bounty_id` (1:1).
- Unique `(bounty_id, pr_number)` on claims when `pr_number` is present (idempotent merge).
- Unique `fee_ledger.bounty_id`.
- Unique `webhook_deliveries.delivery_id` (GitHub redelivery GUID).

## Secrets

`DATABASE_URL` is Secret Manager key `DATABASE_URL` on `experiment-jegf` / `42206083192`. Cloud SQL instance `github-bounties-staging` already exists. **Ops sets the password OOB. Never commit it.**

Google Sign-In (V1-2) also uses Secret Manager keys `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `AUTH_SECRET`. See [google-signin.md](google-signin.md). Never commit those values.

GitHub App (V1-3) uses Secret Manager keys `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY`, plus App id/slug/client as needed. See [github-app.md](github-app.md). Empty placeholders only in `.env.example`.

CDP / x402 (V1-5) uses Secret Manager keys `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` (optional `CDP_PROJECT_ID`, `CDP_CLIENT_API_KEY`). See [escrow.md](escrow.md). Never commit values.

Gemini bounty intelligence (V3-0) uses optional Secret Manager key `GEMINI_API_KEY` (server-only, never `NEXT_PUBLIC_*`). Cache table `bounty_intelligence` from migrate `0005_bounty_intelligence` — V3-0 DEV remount must apply that migrate. See [bounty-intelligence.md](bounty-intelligence.md).
