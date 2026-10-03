<p align="center">
  <a href="https://githubbounties.xyz">
    <img src="apps/web/public/brand/logo-1.png" alt="GitHub Bounties" width="420" />
  </a>
</p>

<p align="center">
  <a href="https://githubbounties.xyz"><strong>PROD</strong></a>
  · Base mainnet USDC<br />
  <a href="https://dev.githubbounties.xyz"><strong>DEV</strong></a>
  · Base Sepolia
</p>

# GitHub Bounties

USDC bounties on GitHub issues. Sign in with Google, connect the GitHub App, post a bounty on an issue, and pay the author of the merged pull request that closes funded `#N`. Hunters work in parallel; **merge is truth**.

This is **not** Lightning Bounties, LB1, or “Lightning Bounties 2”. Older product docs may still live at [docs.lightningbounties.com](https://docs.lightningbounties.com/docs); the shipped product is **GitHub Bounties**.

## Status now

As of **2026-10-03**. No invented ship dates. `/roadmap`, About, and [docs/roadmap.md](docs/roadmap.md) use this list. Chain differs by environment; the versions do not. The homepage has no roadmap section.

| Environment | URL | Chain |
| --- | --- | --- |
| **PROD** | [githubbounties.xyz](https://githubbounties.xyz) | Real USDC on **Base mainnet**. |
| **DEV** | [dev.githubbounties.xyz](https://dev.githubbounties.xyz) | Test USDC on **Base Sepolia**. |

### Shipped

- **V1** — USDC escrow + merge is truth. Google sign-in, GitHub App, board, 2% fee, winner = merged PR author that closes funded #N.
- **V2** — Parallel hunt + participation pool. LIVE on PROD 2026-09-19 (githubbounties.xyz, Base mainnet USDC). V2-0…V2-5: 15% of post-fee to up to 10 hunters, signals, roster, claim-lock sunset.
- **Pool member self-claim** — LIVE on PROD 2026-09-20. Manual pool Claim (#47). Winner Claim pays winner + fee only. Each frozen pool hunter Claims their own share when they have a wallet.
- **FE epic** — LIVE on PROD 2026-09-20. Homepage stats, public roadmap, and vs-Lightning differentiators. Same aggregates as GET /api/stats. Bounty pages include the payout split charts.
- **V3 wave** — LIVE on PROD 2026-09-21. Full GitHub issue + Gemini about/stack/complexity (AI estimates, cached). Related polish: board badges/filters, Settings/Post connected-only, homepage motion/roadmap refresh.
- **Funding wave** — LIVE on PROD 2026-09-24. Crowdfunding (#61): USDC top-ups on already-funded bounties. Fund any public issue (#64) without installing the GitHub App, with Claim running through the public merge poller. Funder avatars (#65 to #67) on the board cards and on the bounty page Funders list.
- **V4 — API + MCP.** DONE, LIVE on PROD 2026-09-25. /api/v1 (OpenAPI) + /mcp, version 4.6.0, 24 operations, 25 tools (#76 #79 #80 #81 #78). API money is OFF on PROD. [MCP](https://githubbounties.xyz/mcp).
- **V5 — MCP page, unfunded edits, admin.** DONE. `/mcp` is the MCP server endpoint and its docs page. Posters edit an unfunded bounty amount on the web, REST, and MCP (`update_bounty_amount`). The admin dashboard on admin hosts sets fee and pool, lists bounties with trash and refund, gates refunds on `ADMIN_REFUND_ENABLED`, and gates fee-wallet withdraws on `ADMIN_WITHDRAW_ENABLED` with a single-use confirm token and a duplicate guard. Admin actions write an admin audit log. No recorded PROD date.

### In progress

- **V6 — Hugging Face.** Bounties on Hugging Face discussions and PRs. In progress. No ship date. Every bounty has `provider`: `github` or `huggingface` (existing rows stay `github`). REST `GET /api/v1/bounties` and MCP `list_bounties` take `provider=github` or `provider=huggingface`. Migration `0016_hf_provider`. Apply on DEV before remount. No env change. GitHub issue, pull request, and merge calls go through `RepoProvider` via `getProvider(bounty.provider)`.

### Next

- **V7 — /bounty command.** A `/bounty` command on GitHub and Hugging Face. Roadmap only. Nothing is built. No ship date.

### Then

- **V8 — Agent economy.** The agent economy on x402. No ship date.

### Parked

- **BTC payouts.** Parked. No schedule.
- **Hosted Coinbase checkout.** Parked until settlement fee / net proceeds equal face (ADR 0001). x402 exact remains the fund rail.

Public roadmap copy: [docs/roadmap.md](docs/roadmap.md).

## V5

What is on `main` today. No PROD ship date is recorded here.

### `/mcp`

`/mcp` is one path with two responses. A browser document request is rewritten to the docs page when `Accept` contains `text/html`, or when a Next.js document header is present (`text/x-component`, `rsc`, `next-router-prefetch`, or `next-url`). That page shows the endpoint, Cursor / Claude / generic config snippets, the tool list, and how to create an API key. MCP clients stay on `POST /mcp` (also `GET`, `DELETE`, and `OPTIONS`): stateless streamable HTTP, `Authorization: Bearer`, cookies ignored.

### Unfunded amount edits

The poster can change the face while the bounty is still unfunded. The bounty page shows **Edit amount** when the viewer is the poster, status is `pending_fund`, the escrow is `pending` with no recorded inbound, and there are no contributions. REST is `PATCH /api/v1/bounties/{id}/amount` with `{ "amount_usdc" }` (write scope, poster only). MCP tool `update_bounty_amount` takes `bounty_id` and `amount_usdc` and calls the same function. The amount uses the same rules as create and must change. Confirmed funding, a contribution, a recorded x402 lock or fund hash, a pending lock, or an in-flight payment is refused (`bounty_has_funds`). A bounty that is not `pending_fund` and has no funding is `bounty_not_editable`. The same face is `amount_unchanged`. The call does not move USDC and does not require `Idempotency-Key`. Hunters may already be working. Each change is stored in `bounty_amount_changes` with source `web`, `rest`, or `mcp`.

### Admin dashboard

The dashboard is the admin host only: `admin.githubbounties.xyz` on PROD and `admin-dev.githubbounties.xyz` on DEV, on the same Cloud Run service as the public site. Public hosts 404 `/admin` and `/api/v1/admin`. Localhost can open `/admin`. Every action needs an admin session.

Fee and pool are `platform_settings` (fee 0.00%–10.00%, pool 10.00%–20.00%; defaults 2% and 15% of post-fee). New bounties are stamped with the current rates. The bounty list searches title, repo, issue, or id and filters by status. Trash is a soft delete (`deleted_at` / `deleted_by`): the row leaves the public board. A bounty that still holds funds is refused until it is refunded. Refund runs the existing refund flow and pays each recorded payer. It does not take a caller-supplied destination.

Refunds stay off unless `ADMIN_REFUND_ENABLED` is exactly `1`. The dashboard disables Refund otherwise, and the server writes a refused audit row and returns `admin_refund_disabled`. Fee-wallet withdraws stay off unless `ADMIN_WITHDRAW_ENABLED` is exactly `1`. A preview writes an admin audit row and mints a single-use confirm token (5 minutes, stored as a hash). The token is consumed before the send and is not reused when the send fails. The duplicate guard refuses the same amount, destination, and network on that fee wallet within 10 minutes unless the admin confirms send-again (`withdraw_duplicate_recent`). A `pending` or `unknown` withdrawal for that fee wallet also blocks another send. `FEE_WALLET_ADDRESS` must match `getAccount({ name: "gb-fee" })` or the withdraw aborts. Neither admin flag turns public fund, cancel, or refund on.

Admin actions (settings, delete, refund, withdraw) write `admin_audit_log` (actor, action, target, before, after, result).

### Migrations

`npm run db:migrate` in `apps/web` applies `apps/web/drizzle/` in journal order through `0016_hf_provider`.

| Migration | What it adds |
| --- | --- |
| `0000_init` | Users, GitHub links, repos, bounties, claim locks, claims, escrows, fee ledger |
| `0001_webhook_deliveries` | `webhook_deliveries` |
| `0002_escrow_fail_reason` | `escrows.fail_code`, `escrows.fail_reason` |
| `0003_webhook_claim_results` | Winner, pull request, repository, and claim-result columns on webhook deliveries |
| `0004_v2_pool_participants` | `pool_participants`, `allocation_ledger`, `work_signals` |
| `0005_bounty_intelligence` | `bounty_intelligence` |
| `0006_user_identity_email_outbox` | Avatar, last seen, welcome enqueue, `email_outbox` |
| `0007_bounty_contributions` | `bounty_contributions` |
| `0008_public_repo_reference` | `public_reference` repos without an App installation |
| `0009_unique_fund_tx_hash` | Unique fund transaction hashes |
| `0010_case_insensitive_fund_tx_hash` | Those unique indexes on `lower(fund_tx_hash)` |
| `0011_api_access` | `api_keys`, `api_request_log`, `api_spend_ledger`, `api_idempotency_keys` |
| `0012_profile_notification_prefs` | `users.display_name_custom`, `user_notification_preferences` |
| `0013_bounty_amount_changes` | `bounty_amount_changes` (`web`, `rest`, `mcp`) |
| `0014_admin_settings_delete_audit` | `platform_settings`, bounty `fee_bps` / `deleted_at` / `deleted_by`, `admin_audit_log`, `admin` API-key scope |
| `0015_fee_withdraw_guards` | `withdraw_confirm_tokens`, `fee_withdrawals` (one row per token; one `pending` or `unknown` row per fee wallet) |
| `0016_hf_provider` | `provider` on bounties, repos, and webhook deliveries (`github` or `huggingface`, default `github`); unused `hf_links` and `bounty_submissions`. Apply on DEV before remount. No env change. |

### Environment

Plain env, not Secret Manager. Empty placeholders live in `apps/web/.env.example`. Do not commit real values.

| Variable | Effect |
| --- | --- |
| `ADMIN_EMAILS` | Comma-separated Google emails. Compared lowercase. Unset or blank means nobody is an admin. When both the user row and the session carry a Google subject, they must match. |
| `ADMIN_REFUND_ENABLED` | Exactly `1` enables admin refunds (dashboard, `/api/v1/admin/*`, admin MCP). Anything else keeps them off. Does not enable public fund, cancel, or refund. |
| `ADMIN_WITHDRAW_ENABLED` | Exactly `1` enables fee-wallet withdraw. A preview writes an audit row and mints a 5-minute single-use confirm token. It does not send USDC, and it is not read-only. `API_MONEY_ENABLED` does not enable it. |
| `FEE_WALLET_ADDRESS` | Expected `gb-fee` address. Withdraw aborts when it is unset or when `getAccount({ name: "gb-fee" })` does not match it. |

## Money path

The product money path **is wired**. PROD moves real USDC. Early V0-A “no prod spend / not wired into UI” language is historical — see [Sandbox](#sandbox--historical-spikes).

| Item | Lock |
| --- | --- |
| Rail | CDP server wallets + x402 USDC on Base (mainnet on PROD, Sepolia on DEV) |
| Escrow | Platform wallet `gb-escrow` holds face **F** until settle or refund |
| Fee | **2% of face** at **settlement** only: `fee = floor(F × 0.02)` → `gb-fee` |
| V2 pool | 15% of **post-fee** (not of face), max 10 hunters; empty pool → winner gets 100% of post-fee (98% of F) |
| Claim-lock | Exclusive 72h lock is **retired** and **never moved money**. Optional **Working on this** is a non-exclusive signal. |
| Fund UX | x402 `exact` to `gb-escrow` + WalletConnect / Pay face. Paste-hash stays under Advanced. Hosted checkout is off. |
| Refund / cancel | Full **F** to the funder. No fee, no pool. |

Decisions, sequences, and failure modes:

- [ADR 0001 — CDP wallets + x402 USDC escrow](docs/adr/0001-cdp-x402-wallets.md) (Accepted)
- [ADR 0002 — DEV fund Lock via x402 `exact`](docs/adr/0002-x402-exact-dev-fund.md)
- [ADR 0003 — V2 multi-hunter pool](docs/adr/0003-v2-multi-hunter-pool.md) (Accepted; V2-0…V2-4 + manual pool Claim shipped)
- [ADR index](docs/adr/README.md)

## Feature map

| Area | Docs |
| --- | --- |
| Bounty post, board, parallel hunt | [docs/bounties.md](docs/bounties.md) |
| Escrow, 2% fee, x402 Lock | [docs/escrow.md](docs/escrow.md) |
| Winner + pool Claim | [docs/claims.md](docs/claims.md) |
| Issue body + Gemini intelligence | [docs/bounty-intelligence.md](docs/bounty-intelligence.md) |
| Sign-in identity + DEV transactional email (welcome and domain events, not remounted) | [docs/email.md](docs/email.md) |
| Public stats (`GET /api/stats`) | [docs/stats.md](docs/stats.md) |
| Public API + MCP (V4, live on PROD) | [docs/api.md](docs/api.md), [MCP](https://githubbounties.xyz/mcp) |
| Google sign-in | [docs/google-signin.md](docs/google-signin.md) |
| GitHub App + webhooks | [docs/github-app.md](docs/github-app.md), [docs/webhooks.md](docs/webhooks.md) |
| Schema | [docs/v1-schema.md](docs/v1-schema.md) |
| DEV deploy / E2E | [docs/staging-deploy.md](docs/staging-deploy.md), [docs/staging-e2e.md](docs/staging-e2e.md) |
| PROD cutover (apex, mainnet, separate stack) | [docs/prod-cutover.md](docs/prod-cutover.md) |

Product app: [`apps/web`](apps/web) (Next.js App Router, Drizzle, Cloud Run `standalone`).

## Provider field

Every bounty has `provider`: `github` or `huggingface`. Existing rows stay `github`. REST `GET /api/v1/bounties` and MCP `list_bounties` take `provider=github` or `provider=huggingface`. Migration `0016_hf_provider`. Apply on DEV before remount. No env change.

## RepoProvider

GitHub issue, pull request, and merge calls go through `RepoProvider` via `getProvider(bounty.provider)`.

## Local development

```bash
docker compose up -d postgres
cd apps/web
cp .env.example .env   # local DATABASE_URL only — never commit .env
npm install
npm run db:migrate
npm run db:seed
npm run test:unit
npm run test:db
npm run dev            # http://localhost:3000
```

Details: [apps/web/README.md](apps/web/README.md). Cloud SQL migrate is Ops-only: [docs/staging-deploy.md](docs/staging-deploy.md).

Root webhook spike (still in CI):

```bash
npm install
npm test
cp .env.example .env   # set GITHUB_WEBHOOK_SECRET locally
GITHUB_WEBHOOK_SECRET='test-secret' npm run replay -- fixtures/pull-request-merged-fixes.json --twice
```

No secrets belong in git. App private keys (`*.pem`) are gitignored. Empty placeholders only in `.env.example`.

## Infra notes

- GCP project is still **`experiment-jegf`** (`42206083192`). DEV and PROD are **separate** Cloud Run services, Cloud SQL instances, and Secret Manager stacks. Do not remount DEV onto the apex.
- Suggested names: DEV `github-bounties-web` / `github-bounties-staging`; PROD `github-bounties-web-prod` / `github-bounties-prod`. See [docs/prod-cutover.md](docs/prod-cutover.md).
- Hosted Coinbase checkout and BTC payouts are parked (see [docs/roadmap.md](docs/roadmap.md)).

## Sandbox / historical spikes

Early V0 tickets proved custody and webhooks **before** product UI. They are not the live status.

```bash
node scripts/money-path-dry-run.mjs
```

Without `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET` the script **exits 2** and lists the missing names. It never broadcasts mainnet USDC. Optional Base Sepolia live fund→release (test USDC only) needs those secrets **and** `CDP_DRY_RUN_LIVE=1`. Notes: [docs/spikes/v0-a-sandbox-dry-run.md](docs/spikes/v0-a-sandbox-dry-run.md).

Webhook HMAC / eligibility fixtures live under repo-root `src/` and stay green via `npm test`. Live App delivery is the product path in `apps/web` ([docs/github-app.md](docs/github-app.md)).
