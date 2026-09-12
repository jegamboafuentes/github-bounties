<p align="center">
  <a href="https://dev.githubbounties.xyz">
    <img src="apps/web/public/brand/logo-1.png" alt="GitHub Bounties" width="420" />
  </a>
</p>

<p align="center">
  <strong>Live staging / dev:</strong> <a href="https://dev.githubbounties.xyz">https://dev.githubbounties.xyz</a>
</p>

# GitHub Bounties

USDC bounties on GitHub issues. Official name: **GitHub Bounties**.

This is not Lightning Bounties, LB1, or “Lightning Bounties 2”.

**V1 winner:** author of the merged pull request that closes funded issue `#N`. Claim-lock (exclusive **72h**) coordinates work; **merge is truth**.

## Money path status

[ADR 0001](docs/adr/0001-cdp-x402-wallets.md) is **Accepted** (product sign-off on PR #1).

**Accepted** — still no prod-wire of escrow into product UI until V1 tickets; Secret Manager + Sepolia dry-run OK when credentials exist. No real USDC production spend. No production user funds.

## Money path (V0-A)

| Item | Lock |
| --- | --- |
| Rail | CDP server wallets + x402 USDC on Base (Sepolia in sandbox) |
| Escrow | Platform CDP wallet `gb-escrow` holds face value |
| Fee | **2% of bounty face** at **settlement**: `fee = floor(face * 0.02)`, hunter gets the remainder |
| Claim-lock | V1 exclusive **72h** coordination lock — **does not move money** |
| V2 | ~15% participation pool later; fee still on full face; not implemented |

Read the decision, sequences, failure modes, and GCP Secret Manager names in:

- [ADR 0001 — CDP wallets + x402 USDC escrow](docs/adr/0001-cdp-x402-wallets.md)
- [ADR index](docs/adr/README.md)

## V0-B — GitHub App webhooks (spike)

Prove App install + signed webhook delivery and the merge→close eligibility predicate. **V1-3** hosts the product path in `apps/web`; this spike stays in CI.

| Item | Where |
| --- | --- |
| Test App setup, minimal permissions, staging URLs | [docs/github-app.md](docs/github-app.md) |
| Predicate, fixture table, replay | [docs/webhooks.md](docs/webhooks.md) |
| HMAC verification | [`src/verify-signature.ts`](src/verify-signature.ts) |
| Eligibility engine | [`src/eligibility.ts`](src/eligibility.ts) |
| Delivery-id store | [`src/delivery-store.ts`](src/delivery-store.ts) |
| Product webhook + Claim write | [`apps/web/src/webhooks/`](apps/web/src/webhooks/) |

Product users sign in with **Google**. The GitHub App is repo authority only.

```bash
npm install
npm test
cp .env.example .env   # set GITHUB_WEBHOOK_SECRET
npm start              # POST /webhooks/github
```

Replay a signed fixture twice (idempotency):

```bash
GITHUB_WEBHOOK_SECRET='test-secret' npm run replay -- fixtures/pull-request-merged-fixes.json --twice
```

No secrets belong in git. App private keys (`*.pem`) are gitignored.

### Live GitHub delivery

Blocked until a staging App and public HTTPS webhook URL exist. Signature checks use GitHub’s published HMAC vector and a locally signed `pull_request` payload. Details: [docs/github-app.md](docs/github-app.md#live-delivery-blocker-this-environment).

## V0-A scope

**In**

- ADR (custody, 2% fee, fund → claim-lock → merge/release → refund)
- Secret Manager key names for GCP project `experiment-jegf` (`42206083192`)
- Sandbox/dry-run notes and a credential-safe stub

**Out** (later tickets)

- Production escrow wired into UI
- Fee dashboards
- Participation pool
- Full app scaffold (V0-B / V0-C)

## Sandbox dry-run

```bash
node scripts/money-path-dry-run.mjs
```

Without `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET` the script
**exits 2** and lists the exact missing secrets. It never broadcasts mainnet USDC.

Optional Base Sepolia live fund→release (test USDC only) requires those secrets **and**
`CDP_DRY_RUN_LIVE=1`. See [spike notes](docs/spikes/v0-a-sandbox-dry-run.md).

Copy [.env.example](.env.example) locally. Do not commit `.env`.

## Product constants

- Platform fee: 2% of face
- V1 claim-lock: 72 hours, exclusive, coordination only
- GCP: `experiment-jegf` / `42206083192`

## V1-1 — App scaffold + schema

Next.js App Router lives in [`apps/web`](apps/web) (Cloud Run `standalone`). **Drizzle** owns versioned Postgres migrations. V0 `src/` (webhooks), `services/hello`, and `infra/` are unchanged.

| Item | Where |
| --- | --- |
| Domain schema (V1-2…V1-6 contract) | [docs/v1-schema.md](docs/v1-schema.md), [`apps/web/src/db/schema.ts`](apps/web/src/db/schema.ts) |
| Migrations | [`apps/web/drizzle/`](apps/web/drizzle/) |
| Local Postgres | `docker compose up -d postgres` then `cd apps/web && npm run db:migrate && npm run db:seed` |
| Secret Manager | key `DATABASE_URL` — Ops sets the value OOB (instance `github-bounties-staging`) |
| Why Drizzle | SQL-first migrations, no Prisma generate/runtime engine; documented in [`apps/web/README.md`](apps/web/README.md) |

```bash
docker compose up -d postgres
cd apps/web
cp .env.example .env   # set DATABASE_URL for local Postgres only
npm install
npm run db:migrate
npm run db:seed
npm run test:unit
npm run test:db
```

Cloud SQL: export `DATABASE_URL` from Secret Manager (never commit it) and run the same `db:migrate` from `apps/web`. Details: [apps/web/README.md](apps/web/README.md#cloud-sql-staging).

## V1-2 — Google Sign-In + session

Auth.js (NextAuth v5) Google provider in `apps/web`. Session cookie is httpOnly (Secure in production). Login upserts `users` by `google_sub`. Setup: [docs/google-signin.md](docs/google-signin.md).

| Item | Where |
| --- | --- |
| Sign in / out | `/signin`, header **Sign out** |
| Profile | `/settings` (protected) |
| Session API | `GET /api/me` (401 if anonymous) |
| Connect GitHub | App install via `/api/github/connect` (V1-3) |
| Env | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `AUTH_SECRET` (empty in `.env.example`) |

Without those vars, `/signin` lists the missing names. CI does not call live Google.

## V1-3 — GitHub App install + webhook worker

Signed-in Google users **Connect GitHub** (App install). `POST /webhooks/github` verifies HMAC, is idempotent by delivery id, and writes `claims.status=eligible` when a merged PR closes funded `#N`.

| Item | Where |
| --- | --- |
| Install / setup / callback | `/api/github/connect`, `/github/setup`, `/github/callback` (Google session required) |
| Webhook | `POST /webhooks/github` (signature auth; **503** if `GITHUB_WEBHOOK_SECRET` is unset) |
| Docs | [docs/github-app.md](docs/github-app.md), [docs/webhooks.md](docs/webhooks.md) |
| Env | `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` (empty in `.env.example`) |

V0-B `npm test` at the repo root stays green. `apps/web` reuses the same fixtures.

## V1-4 — Bounty post + board + 72h claim-lock

Poster creates a bounty from a GitHub issue URL (repo must be App-connected). Board lists and filters. Hunters take an exclusive **72h** claim-lock. **Lock ≠ money**; merge is still truth.

| Item | Where |
| --- | --- |
| Board | `/board` (filter by repo / status; **Claimed by X until …**) |
| Post | `/bounties/new` (Google session) |
| Detail | `/bounties/[id]` — escrow lock, claim, early/force release, poster cancel/refund |
| Expiry | `GET\|POST /api/jobs/expire-claim-locks` or `npm run expire-locks` (locks + `expires_at` refunds) |
| Docs | [docs/bounties.md](docs/bounties.md), [docs/escrow.md](docs/escrow.md) |

Escrow lock records `escrows.status=funded` (real CDP when secrets exist; otherwise a mock hash plus the exact missing `CDP_*` names). DEV fund without a pasted hash: `GET|POST /api/bounties/:id/x402` (x402 `exact` → `gb-escrow`) then Lock. Settle: `POST /api/bounties/:id/settle`. Hosted checkout stays disabled.

## V1-5 — Escrow + 2% fee (CDP / x402)

`gb-escrow` holds face F. Settlement takes `floor(F × 2%)` to `gb-fee` and the remainder to the hunter. Refunds return full F. Base Sepolia by default; mainnet refused unless `CDP_NETWORK=base` **and** `CDP_ALLOW_MAINNET=1`.

| Item | Where |
| --- | --- |
| Service | [`apps/web/src/escrow/`](apps/web/src/escrow/) |
| Docs / Sepolia dry-run | [docs/escrow.md](docs/escrow.md) |
| Env names | `.env.example` `CDP_*` (values never in git) |

Optional live faucet+release still: `CDP_DRY_RUN_LIVE=1 node scripts/money-path-dry-run.mjs` after Ops stashes secrets in Secret Manager.

## V1-6 — Claim payout UI

Eligible hunter (merged PR author, `claims.status=eligible`) enters a BYO Base address and claims net-of-fee USDC. This calls V1-5 `settleEscrow` — it does not add a second money rail. Poster and the board show **Completed (paid)** plus face / 2% fee / net / tx. Non-hunters get a clear `not_hunter` error.

| Item | Where |
| --- | --- |
| Form | `/bounties/[id]`, Settings wallet |
| API | `POST /api/bounties/:id/claim` |
| Docs | [docs/claims.md](docs/claims.md) |

Mock rail remains OK until `CDP_*` is in Secret Manager. Hosted checkout stays disabled.

## GCP staging (V0-C)

Eng runbook: [docs/gcp-bootstrap.md](docs/gcp-bootstrap.md).

| Item | Lock |
| --- | --- |
| Project | `experiment-jegf` / `42206083192` |
| Labels | `product=github-bounties`, `env=staging` |
| Hello | `GET /` and `GET /api/health` → 200 (`services/hello`) |
| Live Cloud Run URL | **blocked: missing gcloud auth / billing** in the bootstrap environment — do not invent a `*.run.app` host |
| Billing account | name `LB_MVP1_Billing_account` (human lock) / id `011B0B-3BA3C5-CCE451` (`gcloud billing`) |

gcloud/Terraform stubs live under [`infra/`](infra/). Hello Cloud Build:
[`cloudbuild.yaml`](cloudbuild.yaml). Evidence: [docs/spikes/v0-c-gcp-bootstrap.md](docs/spikes/v0-c-gcp-bootstrap.md).

## V1-7 — Staging Cloud Run + E2E runbook

`apps/web` deploys to a **new** Cloud Run service `github-bounties-web`. The hello
canary (`github-bounties-hello` / `cloudbuild.yaml`) is unchanged. Ops execute
live migrate + deploy after merge — this repo only lands the wiring and docs.

| Item | Where |
| --- | --- |
| Web image | [`apps/web/Dockerfile`](apps/web/Dockerfile) (`PORT=8080`) |
| Web Cloud Build | [`cloudbuild.web.yaml`](cloudbuild.web.yaml) |
| Deploy helper | [`infra/gcloud/deploy-web.sh`](infra/gcloud/deploy-web.sh) |
| Migrate (SM `DATABASE_URL`) | [`infra/gcloud/migrate-staging.sh`](infra/gcloud/migrate-staging.sh) |
| Secret map + Ops commands | [docs/staging-deploy.md](docs/staging-deploy.md) |
| Closed-beta E2E checklist | [docs/staging-e2e.md](docs/staging-e2e.md) |

```bash
# After merge, on an Ops machine (never from this PR / agent):
./infra/gcloud/migrate-staging.sh --apply
gcloud builds submit --project=experiment-jegf --config=cloudbuild.web.yaml .
gcloud run services describe github-bounties-web \
  --project=experiment-jegf --region=us-central1 \
  --format='value(status.url)'
# Then create SM AUTH_URL from that origin and --update-secrets=AUTH_URL=AUTH_URL:latest
# First revision already has AUTH_TRUST_HOST=true (plain env).
```

Exact `--set-secrets` / `--set-cloudsql-instances` lists: [docs/staging-deploy.md](docs/staging-deploy.md).
Do not invent a `*.run.app` host until that describe succeeds.
