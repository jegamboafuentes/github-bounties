# V1 domain schema (GitHub Bounties)

Contract for tickets **V1-2…V1-6**. Source of truth: [`apps/web/src/db/schema.ts`](../apps/web/src/db/schema.ts) + versioned SQL under [`apps/web/drizzle/`](../apps/web/drizzle/).

**ORM:** Drizzle (SQL-first migrations, no Prisma client runtime).

This is not Lightning Bounties / LB1. Winner later: author of the merged PR that closes funded issue `#N`. Claim-lock is exclusive **72h** coordination and **does not move USDC** (V1-4 board + expiry). Fee is **2%** (`fee_bps = 200`) at settlement.

## Tables

| Table | Role |
| --- | --- |
| `users` | Google identity (`google_sub` unique), email, display name, nullable BYO Base `wallet_address` (V1-6) |
| `github_links` | One GitHub account per user (`github_id`, `github_login`) |
| `repos` | Connected repo (`github_repo_id`, `full_name`, `installation_id`, `connected_by_user_id`, `is_active`) |
| `bounties` | Issue bounty; `amount_usdc`, `currency` default USDC, `chain` default `base` |
| `claim_locks` | Exclusive lock; `expires_at` defaults to `now() + 72 hours`; one `active` row per bounty |
| `escrows` | 1:1 with bounty; fund / payout / fee / refund tx hashes + idempotency key (V1-5); last Lock/settle `fail_code` / `fail_reason` |
| `claims` | `eligible` \| `paid` \| `rejected` \| `disputed`; PR + merge + payout fields |
| `fee_ledger` | `face_usdc`, `fee_usdc`, `fee_bps` default **200**, `settled_at` |
| `webhook_deliveries` | GitHub `X-GitHub-Delivery` GUID primary key (V1-3 idempotency) |

`bounties.participation_pool_bps` / `participation_pool_usdc` are **nullable stubs** for V2. Do not implement the pool.

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
- Unique **one active claim-lock** per `bounty_id`.
- Unique escrow per `bounty_id` (1:1).
- Unique `(bounty_id, pr_number)` on claims when `pr_number` is present (idempotent merge).
- Unique `fee_ledger.bounty_id`.
- Unique `webhook_deliveries.delivery_id` (GitHub redelivery GUID).

## Secrets

`DATABASE_URL` is Secret Manager key `DATABASE_URL` on `experiment-jegf` / `42206083192`. Cloud SQL instance `github-bounties-staging` already exists. **Ops sets the password OOB. Never commit it.**

Google Sign-In (V1-2) also uses Secret Manager keys `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `AUTH_SECRET`. See [google-signin.md](google-signin.md). Never commit those values.

GitHub App (V1-3) uses Secret Manager keys `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY`, plus App id/slug/client as needed. See [github-app.md](github-app.md). Empty placeholders only in `.env.example`.

CDP / x402 (V1-5) uses Secret Manager keys `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` (optional `CDP_PROJECT_ID`, `CDP_CLIENT_API_KEY`). See [escrow.md](escrow.md). Never commit values.
