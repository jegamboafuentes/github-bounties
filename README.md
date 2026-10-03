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

As of **2026-10-03**. No invented ship dates. `/roadmap`, About, and [docs/roadmap.md](docs/roadmap.md) use this list. Chain differs by environment. PROD serves API 4.5.0. 4.9.0 is the DEV and main API version and adds the provider field. The homepage has no roadmap section.

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
- **V4 — API + MCP.** LIVE on PROD 2026-09-25. /api/v1 (OpenAPI) + /mcp (#76 #79 #80 #81 #78). API money is OFF on PROD. PROD serves 4.5.0. 4.9.0 is the DEV and main API version (26 operations, 27 tools) and adds the provider field. [MCP](https://githubbounties.xyz/mcp).
- **V5 — MCP page, unfunded edits, admin.** DONE. `/mcp` is the MCP server endpoint and its docs page. Posters edit an unfunded bounty amount on the web, REST, and MCP (`update_bounty_amount`). The admin dashboard on admin hosts sets fee and pool, lists bounties with trash and refund, gates refunds on `ADMIN_REFUND_ENABLED`, and gates fee-wallet withdraws on `ADMIN_WITHDRAW_ENABLED` with a single-use confirm token and a duplicate guard. Admin actions write an admin audit log. No recorded PROD date.

### In progress

- **V6 — Hugging Face.** Bounties on Hugging Face discussions and PRs. In progress. No ship date. Every bounty has `provider`: `github` or `huggingface` (existing rows stay `github`). REST `GET /api/v1/bounties` and MCP `list_bounties` take `provider=github` or `provider=huggingface`. Migration `0016_hf_provider`. Apply on DEV before remount. A signed-in Google user can connect a Hugging Face account when `HF_OAUTH_CLIENT_ID` and `HF_OAUTH_CLIENT_SECRET` are set. Those secrets are optional. Creating a bounty from a public discussion requires `HF_BOUNTIES_ENABLED=1` (off by default). Claim, merge detection, and payouts are not in this release. GitHub issue, pull request, and merge calls go through `RepoProvider` via `getProvider(bounty.provider)`.

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

Admin actions (settings, delete, refund, withdraw, contacts CSV export) write `admin_audit_log` (actor, action, target, before, after, result).

### Marketing contacts

`marketing_contacts` is the campaign list (migration `0017_marketing_contacts`). One row per email, stored lowercase and trimmed. `source` is `ghb` (a GitHub Bounties sign-up), `lb1` (the imported list), or `both`. `subscribed` starts true. Nothing in this app sets it back to true after it is false.

A new Google sign-up upserts a contact (`source` `ghb`, or `both` when the mailbox was already `lb1`) and links `user_id`. Linking GitHub fills `github_username` and does not change attribution. A failure there is logged and does not fail sign-in.

The first request that carries any `utm_*` param sets a first-party cookie `gb_utm` (JSON: source, medium, campaign, content, term, landing path, and time). It lasts 30 days, is httpOnly, SameSite=Lax, and Secure in production. A later visit does not overwrite it. Values are capped at 100 characters and limited to `[A-Za-z0-9_.-]` (the landing path may also contain `/`). There is no third-party analytics. On first sign-up the cookie is copied onto `users` (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `signup_landing_path`, `attributed_at`) and onto the contact's `utm_*` columns when those are still empty.

Resend audience **LB + GHB Community** (`bae17e81-f141-4204-b096-e6e9eee9c490`) is `RESEND_AUDIENCE_ID`. It reuses `RESEND_API_KEY`. New and changed rows are pushed best-effort (email, first name, last name, and `unsubscribed` only when the row is unsubscribed). `GET` or `POST /api/jobs/sync-contacts` retries rows whose `resend_synced_at` is null or older than `updated_at`, and pulls audience contacts that are unsubscribed. The route uses the same optional `CRON_SECRET` bearer as the other jobs. This repo does not create the schedule.

`POST /api/webhooks/resend` verifies the Svix signature (`svix-id`, `svix-timestamp`, `svix-signature`) with `RESEND_WEBHOOK_SECRET`. `contact.updated` with `unsubscribed: true`, and unsubscribe events, set `subscribed=false` and `unsubscribed_at`. A still-subscribed update does not re-subscribe anyone. If `RESEND_AUDIENCE_ID` is unset, sync is a no-op.

Register the webhook in Resend:

- DEV: `https://dev.githubbounties.xyz/api/webhooks/resend`
- PROD: `https://githubbounties.xyz/api/webhooks/resend`

The admin host Contacts page (`/admin/contacts`) shows total, subscribed, unsubscribed, counts by source, and counts by `utm_campaign` and `utm_content`, with search, a campaign filter, and pagination. CSV export is admin-session only and writes `contacts_export` to `admin_audit_log`. `GET /api/v1/admin/contacts` and `GET /api/v1/admin/contacts/count` need an API key with the `admin` scope. The list accepts `utm_campaign` and each contact includes `utmCampaign`. MCP tools are `list_contacts` (filter `utm_campaign`) and `count_contacts`. A key without that scope gets 403 `forbidden_scope`.

The seed CSVs stay out of git. Ops runs the import against a database. On a fresh database the expected result is 98 rows and 1 unsubscribed (`inserted=98 updated=0 unsubscribed=1`).

DEV first, then PROD:

1. Apply migration `0017_marketing_contacts`. Cloud Run job `github-bounties-migrate`, or locally `cd apps/web && npm run db:migrate` with `DATABASE_URL` pointed at that database (Cloud SQL Auth Proxy for a laptop).
2. Import, from a machine that has the CSVs and `DATABASE_URL`. Do not commit the files. A one-off Cloud Run job can run the same command if the CSVs are mounted there; they are not in the image.

```bash
cd apps/web
npm run contacts:import -- --master /secure/master_list.csv --suppressed /secure/suppressed.csv
```

3. Create Secret Manager versions for `RESEND_AUDIENCE_ID` (`bae17e81-f141-4204-b096-e6e9eee9c490`) and `RESEND_WEBHOOK_SECRET` (the Svix signing secret from Resend). Both are `WEB_OPTIONAL_SECRETS`: a remount attaches them when an enabled version exists and skips them when it does not. `RESEND_API_KEY` is already that shape. Leave them unset and sync stays a no-op.
4. Register the webhook URL above in Resend for contact updated and unsubscribe events.
5. Point Cloud Scheduler at `GET https://dev.githubbounties.xyz/api/jobs/sync-contacts` (PROD: `https://githubbounties.xyz/api/jobs/sync-contacts`) with `Authorization: Bearer <CRON_SECRET>` when that secret is set.

### Migrations

`npm run db:migrate` in `apps/web` applies `apps/web/drizzle/` in journal order through `0017_marketing_contacts`.

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
| `0016_hf_provider` | `provider` on bounties, repos, and webhook deliveries (`github` or `huggingface`, default `github`); `hf_links` (Connect Hugging Face) and `bounty_submissions` (unused until submit). Apply on DEV before remount. No new migration for connect. |
| `0017_marketing_contacts` | `marketing_contacts` (`ghb`, `lb1`, `both`) plus nullable `utm_*` on contacts and `utm_*`, `signup_landing_path`, `attributed_at` on `users`. Apply on DEV before the import. No required env. `RESEND_AUDIENCE_ID` and `RESEND_WEBHOOK_SECRET` are optional. |

### Environment

Plain env, not Secret Manager. Empty placeholders live in `apps/web/.env.example`. Do not commit real values.

| Variable | Effect |
| --- | --- |
| `ADMIN_EMAILS` | Comma-separated Google emails. Compared lowercase. Unset or blank means nobody is an admin. When both the user row and the session carry a Google subject, they must match. |
| `ADMIN_REFUND_ENABLED` | Exactly `1` enables admin refunds (dashboard, `/api/v1/admin/*`, admin MCP). Anything else keeps them off. Does not enable public fund, cancel, or refund. |
| `ADMIN_WITHDRAW_ENABLED` | Exactly `1` enables fee-wallet withdraw. A preview writes an audit row and mints a 5-minute single-use confirm token. It does not send USDC, and it is not read-only. `API_MONEY_ENABLED` does not enable it. |
| `FEE_WALLET_ADDRESS` | Expected `gb-fee` address. Withdraw aborts when it is unset or when `getAccount({ name: "gb-fee" })` does not match it. |
| `RESEND_AUDIENCE_ID` | Optional Secret Manager. Resend audience id for the campaign list. Unset means contact sync is a no-op. DEV/PROD value for LB + GHB Community: `bae17e81-f141-4204-b096-e6e9eee9c490`. |
| `RESEND_WEBHOOK_SECRET` | Optional Secret Manager. Svix signing secret for `POST /api/webhooks/resend`. Unset rejects the webhook. |
| `BASE_BUILDER_CODE` | Optional public [base.dev](https://www.base.dev/) builder code (`^[a-z0-9_]{1,32}$`). The registered code is `bc_u97ii222`. When set, server-sent USDC transfers append an ERC-8021 Schema 0 suffix, and x402 fund challenges declare the same code so the facilitator can settle Schema 2 `{ a, w }`. Unset is a no-op. Not a secret. Ops sets `BASE_BUILDER_CODE=bc_u97ii222` on DEV first, then on PROD on Enrique's GO. |

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

Outbound escrow payouts, refunds, and admin fee withdraws are ERC-20 `transfer` calls from the CDP server wallet. When `BASE_BUILDER_CODE` is set, that calldata carries an ERC-8021 Schema 0 suffix so Base can attribute the transaction. Unset, the calldata is the transfer alone. Those sends use `account.sendTransaction` and pass the persisted idempotency key. `account.transfer()` in `@coinbase/cdp-sdk` 1.55–1.57 dropped that key, so CDP was not de-duplicating them. x402 funding declares the same code on the 402 challenge (`@x402/extensions/builder-code`). The browser payer echoes it. The CDP facilitator reads `a` from that payload and appends Schema 2 `{ a, w }` on the fund transaction. A payer that does not echo the code still settles. The registered code is `bc_u97ii222`. Ops sets `BASE_BUILDER_CODE=bc_u97ii222` on DEV first, then on PROD on Enrique's GO.

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
| PROD (apex, mainnet, shared CDP wallets for now) | [docs/prod-cutover.md](docs/prod-cutover.md) |

Product app: [`apps/web`](apps/web) (Next.js App Router, Drizzle, Cloud Run `standalone`).

## Provider field

Every bounty has `provider`: `github` or `huggingface`. Existing rows stay `github`. REST `GET /api/v1/bounties` and MCP `list_bounties` take `provider=github` or `provider=huggingface`. Migration `0016_hf_provider`. Apply on DEV before remount. No env change.

## RepoProvider

GitHub issue, pull request, and merge calls go through `RepoProvider` via `getProvider(bounty.provider)`.

## Hugging Face

Product login stays **Google**. Hugging Face is a second linked account, the same idea as Connect GitHub. It is off until both OAuth secrets are set. Settings hides **Connect Hugging Face** in that case. `GET`/`POST /api/huggingface/connect`, `GET /huggingface/callback`, and `POST /api/huggingface/disconnect` check the session first and return **401** `unauthorized` when no one is signed in. A signed-in caller then gets **404** `hf_not_configured` when either secret is missing. That body does not name the secrets. GitHub connect is unchanged. Public REST `GET /api/v1/me` and `GET /api/v1/me/linked-accounts`, and MCP `get_me` and `list_linked_accounts`, stay read-only: they return `huggingface: null` when nothing is linked and do not report `hf_not_configured`. Linking and unlinking are not REST or MCP tools.

A signed-in user opens **Settings → Connect Hugging Face**. The app starts an OAuth authorization-code flow with PKCE (`S256`) and scope `openid profile` only. The callback writes one `hf_links` row: Hugging Face user id (`sub`), username (`preferred_username`), https avatar, and `linked_at`. One Hugging Face account per user and one user per Hugging Face account. A second user who tries to link an account that is already linked is refused. **Disconnect** deletes that user's `hf_links` row and does not sign out of Google. Access tokens are not stored.

`GET /api/v1/me/linked-accounts` and MCP `list_linked_accounts` (read scope) include `huggingface: { username, linkedAt } | null` next to the existing GitHub object. MCP `get_me` and `GET /api/v1/me` include the same `huggingface` field. Linking and unlinking stay on Settings. They are not API or MCP tools.

| Variable | Where |
| --- | --- |
| `HF_OAUTH_CLIENT_ID` | Optional Secret Manager secret. `WEB_OPTIONAL_SECRETS`. Attach when an enabled version exists. Skip when it does not, so Cloud Build does not require it. |
| `HF_OAUTH_CLIENT_SECRET` | Same. Not stored in git. |
| `PUBLIC_BASE_URL`, then `AUTH_URL` | Origin of the redirect URI. Local fallback is `http://localhost:3000`. |

Register these redirect URIs on the Hugging Face OAuth app. The path is fixed.

| Environment | Redirect URI |
| --- | --- |
| DEV | `https://dev.githubbounties.xyz/huggingface/callback` |
| PROD | `https://githubbounties.xyz/huggingface/callback` |
| Local | `http://localhost:3000/huggingface/callback` |

## Hugging Face bounties

Posting a bounty from a public Hugging Face discussion uses the same amount rules, fee snapshot, and x402 fund path as a GitHub issue. It is off unless `HF_BOUNTIES_ENABLED=1`. When the flag is off, the website create action, `POST /api/v1/bounties`, and MCP `create_bounty` return `hf_disabled` (**403** on REST) before the amount is checked and before any Hugging Face request. The flag value must be exactly `1`.

Accepted URLs:

| Repo | URL |
| --- | --- |
| Model | `https://huggingface.co/{owner}/{repo}/discussions/{n}` or `https://huggingface.co/models/{owner}/{repo}/discussions/{n}` |
| Dataset | `https://huggingface.co/datasets/{owner}/{repo}/discussions/{n}` |
| Space | `https://huggingface.co/spaces/{owner}/{repo}/discussions/{n}` |

The repo row is `provider=huggingface`, `connection_kind=public_reference`, `github_repo_id` null, and `provider_repo_id` `{model|dataset|space}:{owner}/{repo}`. The discussion number is stored in `github_issue_number`. No new migration.

A pull-request discussion is `hf_not_a_discussion`. A closed or merged discussion is `hf_discussion_closed`. A missing discussion is `hf_discussion_not_found`. `HF_BOT_TOKEN` is optional. When set, discussion reads send `Authorization: Bearer`. Public discussions work without it.

Claiming an HF bounty returns `provider_not_supported`. Merge detection, submissions, and payouts are not in this release. The board can filter `provider=huggingface`. The intelligence card and the public merge poller skip these bounties.

A public discussion to try on DEV: `https://huggingface.co/datasets/stanfordnlp/imdb/discussions/9`.

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

- GCP project is still **`experiment-jegf`** (`42206083192`). DEV and PROD are **separate** Cloud Run services and databases. They share one CDP project and wallet secret; only `CDP_NETWORK` separates the chains. Do not remount DEV onto the apex. See [docs/prod-cutover.md](docs/prod-cutover.md).
- Hosted Coinbase checkout and BTC payouts are parked (see [docs/roadmap.md](docs/roadmap.md)).

## Sandbox / historical spikes

Early V0 tickets proved custody and webhooks **before** product UI. They are not the live status.

```bash
node scripts/money-path-dry-run.mjs
```

Without `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET` the script **exits 2** and lists the missing names. It never broadcasts mainnet USDC. Optional Base Sepolia live fund→release (test USDC only) needs those secrets **and** `CDP_DRY_RUN_LIVE=1`. Notes: [docs/spikes/v0-a-sandbox-dry-run.md](docs/spikes/v0-a-sandbox-dry-run.md).

Webhook HMAC / eligibility fixtures live under repo-root `src/` and stay green via `npm test`. Live App delivery is the product path in `apps/web` ([docs/github-app.md](docs/github-app.md)).
