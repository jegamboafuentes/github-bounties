# GitHub Bounties — web app

Next.js App Router (TypeScript) for Cloud Run, plus the V1 Postgres schema.

**ORM: Drizzle** — SQL-first, versioned migrations next to the app, no Prisma generate step. Schema is the contract for V1-2…V1-6 ([docs/v1-schema.md](../../docs/v1-schema.md)).

This package hosts GitHub App install, `POST /webhooks/github`, the bounty board / 72h claim-lock, V1-5 CDP escrow (2% at settlement), and V1-6 hunter claim payout. The V0-B spike at repo-root `src/` stays in CI (`npm test` from the repository root). `services/hello` remains the Cloud Run canary.

## Product locks

| Item | Value |
| --- | --- |
| Name | GitHub Bounties |
| Fee | 2% → `fee_ledger.fee_bps` default **200** |
| Claim-lock | exclusive **72h** (`expires_at` default `now() + 72 hours`) |
| Winner | author of the merged PR that closes funded `#N` |
| CDP / x402 | V1-5 escrow lock / settle / refund (x402 exact inbound on DEV; mock if `CDP_*` missing; hosted checkout disabled) |
| Payout | V1-6 eligible hunter claims net-of-fee USDC to a BYO Base address |

## Local Postgres + migrate

Docker (from the **repository root**):

```bash
docker compose up -d postgres
# wait until healthy (docker compose ps)
```

Compose uses a **local placeholder** role (see `docker-compose.yml`). That is not Cloud SQL and not a staging password.

```bash
cd apps/web
cp .env.example .env
# set DATABASE_URL to your local Postgres (placeholder user from compose)
npm install
npm run db:migrate    # applies drizzle/ on an empty database
npm run db:seed
npm run test:unit
npm run test:db
npm run dev           # http://localhost:3000  and  /api/health
```

Without Docker, any Postgres 16 is fine. Create an empty database and point `DATABASE_URL` at it. Do not commit `.env`.

Re-running migrate and seed is safe (idempotent).

### Evidence command

```bash
cd apps/web && npm run db:migrate && npm run db:seed && npm run test:unit && npm run test:db
```

CI runs the same against an empty `postgres:16` service (`.github/workflows/ci.yml`).

## Cloud SQL (staging)

Instance **`github-bounties-staging`** exists in GCP project `experiment-jegf` / `42206083192`, database `github_bounties`.

Ops runbook (V1-7): [docs/staging-deploy.md](../../docs/staging-deploy.md). Prefer the scripted path so `DATABASE_URL` is never echoed:

```bash
./infra/gcloud/migrate-staging.sh              # dry-run
./infra/gcloud/migrate-staging.sh --apply      # Auth Proxy + drizzle
./infra/gcloud/migrate-staging.sh --apply --job  # Cloud Run Job one-shot
```

1. Ops places the connection string in Secret Manager key **`DATABASE_URL`**. Do not invent or ask for the password in chat/PRs.
2. Reach the instance with Cloud SQL Auth Proxy or a Cloud Run job that mounts the unix socket (see [docs/gcp-bootstrap.md](../../docs/gcp-bootstrap.md)).
3. Export `DATABASE_URL` in your shell **from the secret** (never paste it into git).
4. From `apps/web`: `npm run db:migrate` then optionally `npm run db:seed` (seed is for empty/dev DBs — not a default staging step).

Shapes (password never in git):

```text
# Auth Proxy
postgresql://gb_app:PASSWORD@127.0.0.1:5432/github_bounties?sslmode=require

# Cloud Run unix socket — SM *source* shape (`localhost` so Node can parse).
# Runtime sets postgres.js options.host from host= and strips that query key
# before connect (postgres.js would otherwise send host as a startup GUC).
postgresql://gb_app:PASSWORD@localhost/github_bounties?host=/cloudsql/experiment-jegf:us-central1:github-bounties-staging
```

## Cloud Run

`output: "standalone"` and [`Dockerfile`](./Dockerfile) listen on `PORT` (default 8080).

| Path | Service | Config |
| --- | --- | --- |
| Hello canary | `github-bounties-hello` | [`cloudbuild.yaml`](../../cloudbuild.yaml) — **unchanged** |
| V1 product | `github-bounties-web` | [`cloudbuild.web.yaml`](../../cloudbuild.web.yaml), [`infra/gcloud/deploy-web.sh`](../../infra/gcloud/deploy-web.sh) |
| Migrate job | `github-bounties-migrate` | [`Dockerfile.migrate`](./Dockerfile.migrate) |

```bash
gcloud builds submit --project=experiment-jegf --config=cloudbuild.web.yaml .
```

First deploy sets `AUTH_TRUST_HOST=true` (plain env) and binds SM names that
already have versions (including `GITHUB_APP_ID` / `GITHUB_APP_SLUG` / CDP keys).
It does **not** bind `CDP_WEBHOOK_SECRET` (0 versions), `CRON_SECRET` (not in SM),
or `AUTH_URL` (add after the live origin). See [docs/staging-deploy.md](../../docs/staging-deploy.md).

Do not point `cloudbuild.yaml` at this app. Closed-beta checklist: [docs/staging-e2e.md](../../docs/staging-e2e.md).

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run db:generate` | `drizzle-kit generate` after schema edits (diff from `drizzle/meta/*_snapshot.json`) |
| `npm run db:migrate` | apply `drizzle/` SQL to `DATABASE_URL` (`0003_webhook_claim_results.sql` + snapshots) |
| `npm run db:seed` | sample user / repo / pending_fund + claim-locked + open funded bounty |
| `npm run expire-locks` | expire overdue 72h claim-locks (same function as the cron route) |
| `npm run test:unit` | fee 2% + Base address + escrow state machine + CDP env/mainnet guard + 72h + auth + V0-B eligibility fixtures + HMAC + webhook replay + board helpers (no live GitHub, no database) |
| `npm run test:db` | unique indexes + `users.google_sub` upsert + eligible Claim + claim-lock exclusivity/expiry + escrow fund/settle/refund + hunter-only payout mocks + GitHub unlink (needs `DATABASE_URL`) |
| `npm run build` | Next.js standalone |

## Google Sign-In (V1-2)

Auth.js / NextAuth v5 with the Google provider. Documented in [docs/google-signin.md](../../docs/google-signin.md).

```bash
# apps/web/.env — never commit real values
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
AUTH_SECRET=
```

Redirect URIs to register on the GCP OAuth **Web** client (`experiment-jegf` / `42206083192`):

- `http://localhost:3000/api/auth/callback/google`
- `https://<cloud-run-host>/api/auth/callback/google` (use the real Cloud Run URL; do not invent a host)

`/settings`, `/bounties/new`, and `GET /api/me` require a session.

## GitHub App install + webhooks (V1-3)

Connect GitHub requires a Google session. The webhook is server-to-server (HMAC).

```bash
# apps/web/.env — never commit real values
GITHUB_WEBHOOK_SECRET=
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY=
```

| URL | Auth |
| --- | --- |
| `POST /webhooks/github` | `X-Hub-Signature-256` (503 if secret missing) |
| `GET /api/github/connect` | Google session → redirect to App install |
| `/github/setup`, `/github/callback` | Google session; confirm `installation_id` via App JWT |

See [docs/github-app.md](../../docs/github-app.md) and [docs/webhooks.md](../../docs/webhooks.md).

If Google env is missing, `/signin` lists the unset variable names. Home and `/api/health` still work. If GitHub App env is missing, Settings shows the documented blocker; webhooks return 503.

## Bounty board + 72h claim-lock (V1-4)

| URL | Auth |
| --- | --- |
| `/board` | public list + repo/status filters |
| `/bounties/new` | Google session; issue URL must match an App-connected repo |
| `/bounties/[id]` | escrow lock (poster), claim-lock (hunter), hunter payout claim, early/force release, cancel/refund |
| `GET\|POST /api/jobs/expire-claim-locks` | optional `CRON_SECRET` bearer |

Claim-lock is exclusive **72h** coordination. **It does not move money.** Merge is still truth (V1-3 eligible Claim). See [docs/bounties.md](../../docs/bounties.md).

## Escrow + 2% fee (V1-5)

| Item | Where |
| --- | --- |
| Lock / settle / refund | [`src/escrow/`](./src/escrow/) |
| Settle API | `POST /api/bounties/:id/settle` |
| Refund API | `POST /api/bounties/:id/refund` |
| Env | `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` (empty placeholders; same SM names as repo-root `.env.example`) |
| Docs | [docs/escrow.md](../../docs/escrow.md) |

Missing `CDP_*` → mock rail that records `mock:` hashes and lists the exact missing names. Mainnet (`CDP_NETWORK=base`) is refused unless `CDP_ALLOW_MAINNET=1`. Hosted checkout is disabled (ADR 0001 `settlement.feeAmount` open Q).

## Claim payout (V1-6)

Eligible hunter (merged PR author) claims net-of-fee USDC to a BYO Base address. Calls V1-5 `settleEscrow`. Poster and the board show **Completed (paid)**.

| Item | Where |
| --- | --- |
| Form | `/bounties/[id]` + Settings wallet |
| API | `POST /api/bounties/:id/claim` (hunter-only) |
| Docs | [docs/claims.md](../../docs/claims.md) |

## Out of scope (later tickets)

- Participation-pool accounting beyond nullable columns
- Enabling hosted checkout before net proceeds == face is confirmed
- Custodial wallets / dispute window / agent marketplace
