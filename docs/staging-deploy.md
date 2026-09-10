# Staging deploy — `apps/web` on Cloud Run (V1-7)

Ops runbook for **GitHub Bounties** staging in GCP project `experiment-jegf` /
`42206083192`, region `us-central1`. This is **not** the hello canary.

**Do not apply live GCP from a Cloud Agent / laptop that is not Ops.** Scripts
default to dry-run. This file documents the exact commands after merge.

Canonical project lock: [`gcp-bootstrap.md`](gcp-bootstrap.md). Closed-beta
checklist: [`staging-e2e.md`](staging-e2e.md).

| Item | Value |
| --- | --- |
| Product service | `github-bounties-web` (new; do not reuse hello) |
| Hello canary | `github-bounties-hello` — [`cloudbuild.yaml`](../cloudbuild.yaml) unchanged |
| Image repo | `us-central1-docker.pkg.dev/experiment-jegf/github-bounties` |
| Cloud SQL | `github-bounties-staging` / db `github_bounties` / user `gb_app` |
| Runtime SA | `github-bounties-runtime@experiment-jegf.iam.gserviceaccount.com` |
| Labels | `product=github-bounties,env=staging` |
| Port | `8080` |
| Health | `GET /api/health` → 200 JSON `service=github-bounties-web` |

Live `*.run.app` URL: **do not invent one**. Read it after a successful deploy
(see [Find the live URL](#4-find-the-live-url)).

---

## 0. Preconditions

```bash
./infra/gcloud/preflight.sh          # must exit 0 on the Ops machine
./infra/gcloud/list-secret-versions.sh   # names + has-version only
```

Required Secret Manager **names** need an **enabled version** before web deploy
(see [Secret map](#secret-map-web-runtime)). `GITHUB_APP_CLIENT_ID` already has
a version. `CDP_WEBHOOK_SECRET` may stay empty (do not attach it until it has a
version). Missing `CDP_API_KEY_*` / `CDP_WALLET_SECRET` → mock rail (OK).

Create empty secrets if bootstrap never ran the new names (`AUTH_SECRET`,
`GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `CRON_SECRET`):

```bash
./infra/gcloud/bootstrap.sh          # dry-run
./infra/gcloud/bootstrap.sh --apply  # live, idempotent creates
```

Add a version from stdin (never git, never echo):

```bash
gcloud secrets versions add AUTH_SECRET --data-file=- --project=experiment-jegf
# paste value, newline, Ctrl-D
```

---

## 1. Migrate against Cloud SQL

Uses Secret Manager `DATABASE_URL`. **Never** print or paste the value.

### A. Laptop + Cloud SQL Auth Proxy (default)

```bash
./infra/gcloud/migrate-staging.sh                 # dry-run
./infra/gcloud/migrate-staging.sh --apply         # starts proxy, loads SM, drizzle migrate
```

The script:

1. Starts `cloud-sql-proxy experiment-jegf:us-central1:github-bounties-staging`.
2. Captures `gcloud secrets versions access latest --secret=DATABASE_URL` (not printed).
3. If the secret is the Cloud Run unix-socket shape, rewrites host to
   `127.0.0.1:5432` **in-process** ([`infra/gcloud/proxy-database-url.mjs`](../infra/gcloud/proxy-database-url.mjs)).
4. Runs `cd apps/web && npm run db:migrate`.
5. Unsets `DATABASE_URL` and stops the proxy.

Install the proxy if needed: [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy)
or `gcloud components install cloud-sql-proxy`.

### B. Cloud Run Job one-shot (no laptop proxy)

Use this when `DATABASE_URL` is the unix-socket form and you do not want a local
proxy. Builds [`apps/web/Dockerfile.migrate`](../apps/web/Dockerfile.migrate).

```bash
./infra/gcloud/migrate-staging.sh --job            # dry-run
./infra/gcloud/migrate-staging.sh --apply --job    # build, create/update job, execute --wait
```

Equivalent after the migrate image is in Artifact Registry:

```bash
gcloud run jobs execute github-bounties-migrate \
  --project=experiment-jegf --region=us-central1 --wait
```

Do **not** run `db:seed` on staging unless Ops explicitly wants fixture rows.

---

## 2. Build + deploy web (`gcloud builds submit`)

Hello stays on [`cloudbuild.yaml`](../cloudbuild.yaml). Web uses
[`cloudbuild.web.yaml`](../cloudbuild.web.yaml).

```bash
# From repo root, after migrate succeeds:
gcloud builds submit --project=experiment-jegf --config=cloudbuild.web.yaml .
```

Optional substitutions (plain env, not secrets):

```bash
gcloud builds submit --project=experiment-jegf --config=cloudbuild.web.yaml \
  --substitutions=COMMIT_SHA=$(git rev-parse HEAD),_GITHUB_APP_ID=<numeric-app-id>,_GITHUB_APP_SLUG=<app-slug>,_PUBLIC_BASE_URL=<https-origin-after-first-url>
```

`_PUBLIC_BASE_URL` is empty on the first submit (chicken/egg). After you have
the live origin, re-submit or `gcloud run services update` (below).

Attach optional CDP / `CRON_SECRET` **only** when those names have versions:

```bash
gcloud builds submit --project=experiment-jegf --config=cloudbuild.web.yaml \
  --substitutions=_ATTACH_OPTIONAL_SECRETS=1
```

Laptop equivalent (dry-run by default):

```bash
./infra/gcloud/deploy-web.sh
./infra/gcloud/deploy-web.sh --apply
# Cloud Build already pushed an image:
./infra/gcloud/deploy-web.sh --apply --image=us-central1-docker.pkg.dev/experiment-jegf/github-bounties/github-bounties-web:BUILD_ID
```

Hello (unchanged):

```bash
gcloud builds submit --project=experiment-jegf --config=cloudbuild.yaml .
./infra/gcloud/deploy-hello.sh --apply
```

---

## 3. Secret map (web runtime)

Cloud Run `--set-secrets=ENV=NAME:latest`. Names only.

| Env var | Secret Manager id | Required | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | `DATABASE_URL` | yes | Unix-socket form for Cloud Run; see bootstrap |
| `AUTH_SECRET` | `AUTH_SECRET` | yes | Auth.js cookie encryption |
| `GOOGLE_OAUTH_CLIENT_ID` | `GOOGLE_OAUTH_CLIENT_ID` | yes | Product login |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `GOOGLE_OAUTH_CLIENT_SECRET` | yes | Product login |
| `GITHUB_WEBHOOK_SECRET` | `GITHUB_WEBHOOK_SECRET` | yes | HMAC; webhook **503** if missing |
| `GITHUB_APP_PRIVATE_KEY` | `GITHUB_APP_PRIVATE_KEY` | yes | PEM; never commit |
| `GITHUB_APP_CLIENT_ID` | `GITHUB_APP_CLIENT_ID` | yes | Version already exists |
| `GITHUB_APP_CLIENT_SECRET` | `GITHUB_APP_CLIENT_SECRET` | yes | User-to-server OAuth |
| `CDP_API_KEY_ID` | `CDP_API_KEY_ID` | no | Mock rail if any of the three required CDP keys missing |
| `CDP_API_KEY_SECRET` | `CDP_API_KEY_SECRET` | no | |
| `CDP_WALLET_SECRET` | `CDP_WALLET_SECRET` | no | |
| `CDP_PROJECT_ID` | `CDP_PROJECT_ID` | no | |
| `CDP_CLIENT_API_KEY` | `CDP_CLIENT_API_KEY` | no | |
| `CDP_WEBHOOK_SECRET` | `CDP_WEBHOOK_SECRET` | no | May stay empty — do not `--set-secrets` until a version exists |
| `CRON_SECRET` | `CRON_SECRET` | no | Bearer for `/api/jobs/expire-claim-locks` |

Plain env (not Secret Manager):

| Env | Source | Notes |
| --- | --- | --- |
| `GITHUB_APP_ID` | `_GITHUB_APP_ID` / shell | Numeric App id |
| `GITHUB_APP_SLUG` | `_GITHUB_APP_SLUG` / shell | Install URL slug |
| `PUBLIC_BASE_URL` / `AUTH_URL` | live Cloud Run origin | Set after first URL |
| `CDP_NETWORK` | default `base-sepolia` | Mainnet refused without `CDP_ALLOW_MAINNET=1` |
| `NODE_ENV` | `production` | Set by deploy |
| `PORT` | `8080` | Cloud Run |

`--set-secrets` fails if the named secret has **no enabled version**. Discover
mode (`deploy-web.sh` default on a laptop) binds only names that have versions
and refuses `--apply` when a required name is empty. Cloud Build uses
`--secrets=static` (required list).

Rotate: add a new SM version, then deploy a no-op revision (or re-submit this
build) so instances restart. See [gcp-bootstrap.md](gcp-bootstrap.md#rotate-secrets).

---

## 4. Find the live URL

```bash
gcloud run services describe github-bounties-web \
  --project=experiment-jegf --region=us-central1 \
  --format='value(status.url)'
```

Record that origin. Then:

```bash
URL="$(gcloud run services describe github-bounties-web \
  --project=experiment-jegf --region=us-central1 \
  --format='value(status.url)')"

gcloud run services update github-bounties-web \
  --project=experiment-jegf --region=us-central1 \
  --update-env-vars="PUBLIC_BASE_URL=${URL},AUTH_URL=${URL}"
```

Register the same origin on:

- Google OAuth Web client: JS origin + `/api/auth/callback/google` ([google-signin.md](google-signin.md))
- GitHub App: webhook `/webhooks/github`, setup `/github/setup`, callback `/github/callback` ([github-app.md](github-app.md))

`--allow-unauthenticated` is for the closed-beta browser + GitHub webhooks.
**Unauth GET may still 403** under Domain Restricted Sharing. Do not add a
public invoker binding if org policy forbids `allUsers`. Grant
`roles/run.invoker` to testers and use:

```bash
curl -sS -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$URL/api/health"
```

GitHub webhook deliveries are unauthenticated POSTs. If DRS blocks `allUsers`,
webhooks will 403 until Ops adds an org-approved ingress path (not invented here).

---

## 5. Health smoke

Expect `200` and JSON (names only; `escrow.missing` lists unset CDP keys, never values):

```json
{
  "ok": true,
  "service": "github-bounties-web",
  "product": "GitHub Bounties",
  "fee_bps": 200,
  "claim_lock_hours": 72,
  "escrow": {
    "wired": true,
    "rail": "mock",
    "network": "base-sepolia",
    "missing": ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET"]
  }
}
```

`rail` is `cdp` when the three required CDP secrets are present and the network
is safe. `escrow.hosted_checkout.enabled` stays `false`. Home (`GET /`) is the
product UI (HTML), not the hello JSON canary.

Hello canary (separate service): `GET /` and `GET /api/health` →
`service=github-bounties-hello`.

---

## Out of scope

- This PR does **not** run `gcloud --apply` against staging.
- Production marketing, V2 pool, load tests.
- Secret values in git or PR text.
