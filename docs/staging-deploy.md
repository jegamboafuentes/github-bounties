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
| Cloud SQL | `github-bounties-staging` — **RUNNABLE** (Ops 2026-09-10) |
| connectionName | `experiment-jegf:us-central1:github-bounties-staging` |
| requireSsl | `true` on the instance. Cloud Run unix socket is fine. Auth Proxy on localhost needs `sslmode=disable` (proxy already encrypts to Cloud SQL; `sslmode=require` → ECONNRESET). Public-IP TCP clients still use `sslmode=require`. |
| Runtime SA | `github-bounties-runtime@experiment-jegf.iam.gserviceaccount.com` — already has `cloudsql.client` + `secretmanager.secretAccessor` + `logging.logWriter` |
| Labels | `product=github-bounties,env=staging` |
| Port | `8080` |
| Health | `GET /api/health` → 200 JSON `service=github-bounties-web` |

Live `*.run.app` URL: **do not invent one**. Read it after a successful deploy
(see [Find the live URL](#4-find-the-live-url)).

---

## Ops preflight (2026-09-10, names only)

Confirmed on `experiment-jegf`. **No secret values** are recorded here.

| Check | Status |
| --- | --- |
| Cloud SQL `github-bounties-staging` | `RUNNABLE` |
| `connectionName` | `experiment-jegf:us-central1:github-bounties-staging` |
| `requireSsl` | `true` |
| Runtime SA IAM | `cloudsql.client`, `secretmanager.secretAccessor`, `logging.logWriter` already bound |

**Secret Manager — enabled versions present** (bind on first deploy):

`DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`,
`GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`,
`CDP_WALLET_SECRET`, `CDP_PROJECT_ID`, `CDP_CLIENT_API_KEY`.

**Do not bind on first deploy:**

| Name | Why |
| --- | --- |
| `CDP_WEBHOOK_SECRET` | Resource exists, `enabled_versions=0` (`--set-secrets` would fail) |
| `CRON_SECRET` | Not in SM. Expire-locks stays open for smoke (optional later) |
| `AUTH_URL` | Not in SM. Create **after** the live Cloud Run origin exists |
| `AUTH_TRUST_HOST` | Not a secret. First deploy uses plain env `AUTH_TRUST_HOST=true` |

Re-check names only: `./infra/gcloud/list-secret-versions.sh`

---

## 0. Preconditions

```bash
./infra/gcloud/preflight.sh          # must exit 0 on the Ops machine
./infra/gcloud/list-secret-versions.sh   # names + has-version only
```

Runtime SA IAM and SQL are already in place (preflight above). Skip bootstrap
unless you need a new empty secret resource (`AUTH_URL` after first URL, or
`CRON_SECRET` later).

Add a version from stdin (never git, never echo):

```bash
gcloud secrets versions add AUTH_URL --data-file=- --project=experiment-jegf
# paste the https origin only, newline, Ctrl-D
```

---

## 1. Migrate against Cloud SQL

Uses Secret Manager `DATABASE_URL`. **Never** print or paste the value.
`requireSsl=true` is satisfied by Auth Proxy or the Cloud Run unix socket.

### A. Helper (preferred)

```bash
./infra/gcloud/migrate-staging.sh                 # dry-run
./infra/gcloud/migrate-staging.sh --apply         # Auth Proxy + drizzle
./infra/gcloud/migrate-staging.sh --apply --job   # Cloud Run Job one-shot
```

### B. Exact laptop + Auth Proxy commands

```bash
cloud-sql-proxy experiment-jegf:us-central1:github-bounties-staging --port=5432
```

In another shell (capture only — do not `echo`, do not `set -x`):

```bash
cd apps/web
npm ci   # if node_modules is missing
export DATABASE_URL="$(gcloud secrets versions access latest --secret=DATABASE_URL --project=experiment-jegf)"
node ../../infra/gcloud/proxy-database-url.mjs --exec npm run db:migrate
unset DATABASE_URL
```

The helper rewrites a unix-socket `DATABASE_URL` to `127.0.0.1:5432` in-process
and never prints it. It **forces `sslmode=disable`**: Cloud SQL Auth Proxy
already encrypts the hop to the instance, and `sslmode=require` against the
local proxy port caused `ECONNRESET` on the first live migrate. Do **not** run
`db:seed` on staging unless Ops explicitly wants fixture rows.

### C. Exact Cloud Run Job commands

After `apps/web/Dockerfile.migrate` is in Artifact Registry as
`us-central1-docker.pkg.dev/experiment-jegf/github-bounties/github-bounties-migrate:staging`:

```bash
gcloud run jobs create github-bounties-migrate \
  --project=experiment-jegf \
  --region=us-central1 \
  --image=us-central1-docker.pkg.dev/experiment-jegf/github-bounties/github-bounties-migrate:staging \
  --service-account=github-bounties-runtime@experiment-jegf.iam.gserviceaccount.com \
  --set-cloudsql-instances=experiment-jegf:us-central1:github-bounties-staging \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --memory=512Mi --cpu=1 --task-timeout=10m --max-retries=1 \
  --labels=product=github-bounties,env=staging
# if the job already exists: gcloud run jobs update … (same flags)

gcloud run jobs execute github-bounties-migrate \
  --project=experiment-jegf --region=us-central1 --wait
```

---

## 2. Build + deploy web

Hello stays on [`cloudbuild.yaml`](../cloudbuild.yaml). Web uses
[`cloudbuild.web.yaml`](../cloudbuild.web.yaml).

### A. `gcloud builds submit` (preferred)

```bash
gcloud builds submit --project=experiment-jegf --config=cloudbuild.web.yaml .
```

Optional SHA tag only:

```bash
gcloud builds submit --project=experiment-jegf --config=cloudbuild.web.yaml \
  --substitutions=COMMIT_SHA=$(git rev-parse HEAD)
```

That build deploys `${_SERVICE}` (`github-bounties-web`) with
`--set-cloudsql-instances=experiment-jegf:us-central1:github-bounties-staging`,
`AUTH_TRUST_HOST=true` as **plain env**, and the first-deploy `--set-secrets`
list below. It does **not** bind `CDP_WEBHOOK_SECRET`, `CRON_SECRET`, or
`AUTH_URL`.

**First-deploy gotchas (fixed in-repo):**

- `cloudbuild.web.yaml` must call `deploy-web.sh` with **space** flags
  (`--secrets static --service "${_SERVICE}" --image "…"`). The first submit
  used `--secrets=static`, which the helper treated as one unknown token
  (gcloud-style `=` parsing). Do not put `--secrets=static` back in the YAML.
- `deploy-web.sh` still accepts Ops recovery flags `--secrets=static` and
  `--image=IMAGE` (equals form) as well as the space form.
- Auth Proxy migrate rewrite must use `sslmode=disable` (see above). Cloud Run
  unix-socket `DATABASE_URL` in Secret Manager is unchanged.

Hello (unchanged):

```bash
gcloud builds submit --project=experiment-jegf --config=cloudbuild.yaml .
```

Laptop helper: `./infra/gcloud/deploy-web.sh` (dry-run) or `--apply`.

### B. Exact `gcloud run deploy` (after the image exists)

Replace `BUILD_ID` with the tag Cloud Build pushed (or `:staging` / `:latest`).

```bash
gcloud run deploy github-bounties-web \
  --project=experiment-jegf \
  --region=us-central1 \
  --image=us-central1-docker.pkg.dev/experiment-jegf/github-bounties/github-bounties-web:BUILD_ID \
  --service-account=github-bounties-runtime@experiment-jegf.iam.gserviceaccount.com \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --max-instances=2 \
  --set-cloudsql-instances=experiment-jegf:us-central1:github-bounties-staging \
  --set-env-vars=NODE_ENV=production,AUTH_TRUST_HOST=true,CDP_NETWORK=base-sepolia \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,AUTH_SECRET=AUTH_SECRET:latest,GOOGLE_OAUTH_CLIENT_ID=GOOGLE_OAUTH_CLIENT_ID:latest,GOOGLE_OAUTH_CLIENT_SECRET=GOOGLE_OAUTH_CLIENT_SECRET:latest,GITHUB_APP_ID=GITHUB_APP_ID:latest,GITHUB_APP_SLUG=GITHUB_APP_SLUG:latest,GITHUB_WEBHOOK_SECRET=GITHUB_WEBHOOK_SECRET:latest,GITHUB_APP_PRIVATE_KEY=GITHUB_APP_PRIVATE_KEY:latest,GITHUB_APP_CLIENT_ID=GITHUB_APP_CLIENT_ID:latest,GITHUB_APP_CLIENT_SECRET=GITHUB_APP_CLIENT_SECRET:latest,CDP_API_KEY_ID=CDP_API_KEY_ID:latest,CDP_API_KEY_SECRET=CDP_API_KEY_SECRET:latest,CDP_WALLET_SECRET=CDP_WALLET_SECRET:latest,CDP_PROJECT_ID=CDP_PROJECT_ID:latest,CDP_CLIENT_API_KEY=CDP_CLIENT_API_KEY:latest \
  --allow-unauthenticated \
  --labels=product=github-bounties,env=staging
```

`--set-secrets` is `ENV=SECRET_NAME:latest` (names only). Do **not** add
`CDP_WEBHOOK_SECRET`, `CRON_SECRET`, or `AUTH_URL` on this first revision.

Optional WalletConnect QR (public Reown project id — **not** SM): append
`,NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<reown-project-id>` to `--set-env-vars`,
or `export NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=…` before `deploy-web.sh`.

---

## 3. Secret map (web runtime)

Cloud Run `--set-secrets=ENV=NAME:latest`. Names only.

| Env var | Secret Manager id | First deploy | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | `DATABASE_URL` | yes | Unix-socket form for Cloud Run |
| `AUTH_SECRET` | `AUTH_SECRET` | yes | Auth.js cookie encryption |
| `GOOGLE_OAUTH_CLIENT_ID` | `GOOGLE_OAUTH_CLIENT_ID` | yes | Product login |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `GOOGLE_OAUTH_CLIENT_SECRET` | yes | Product login |
| `GITHUB_APP_ID` | `GITHUB_APP_ID` | yes | Enabled version present |
| `GITHUB_APP_SLUG` | `GITHUB_APP_SLUG` | yes | Enabled version present |
| `GITHUB_WEBHOOK_SECRET` | `GITHUB_WEBHOOK_SECRET` | yes | HMAC; webhook **503** if missing |
| `GITHUB_APP_PRIVATE_KEY` | `GITHUB_APP_PRIVATE_KEY` | yes | PEM |
| `GITHUB_APP_CLIENT_ID` | `GITHUB_APP_CLIENT_ID` | yes | Enabled version present |
| `GITHUB_APP_CLIENT_SECRET` | `GITHUB_APP_CLIENT_SECRET` | yes | User-to-server OAuth |
| `CDP_API_KEY_ID` | `CDP_API_KEY_ID` | yes | Sepolia / live rail |
| `CDP_API_KEY_SECRET` | `CDP_API_KEY_SECRET` | yes | |
| `CDP_WALLET_SECRET` | `CDP_WALLET_SECRET` | yes | |
| `CDP_PROJECT_ID` | `CDP_PROJECT_ID` | yes | |
| `CDP_CLIENT_API_KEY` | `CDP_CLIENT_API_KEY` | yes | |
| `CDP_WEBHOOK_SECRET` | `CDP_WEBHOOK_SECRET` | **no** | `enabled_versions=0` |
| `CRON_SECRET` | `CRON_SECRET` | **no** | Not in SM; optional after smoke |
| `AUTH_URL` | `AUTH_URL` | **no** | Create after live origin |

Plain env (not Secret Manager):

| Env | First deploy | Notes |
| --- | --- | --- |
| `AUTH_TRUST_HOST` | `true` | Not in SM. Auth.js already `trustHost: true`; set the env anyway |
| `CDP_NETWORK` | `base-sepolia` | Mainnet refused without `CDP_ALLOW_MAINNET=1` |
| `NODE_ENV` | `production` | |
| `PORT` | `8080` | Cloud Run |
| `PUBLIC_BASE_URL` | omit | Optional env after live origin (GitHub URL helpers) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | omit | Public Reown Cloud project id (not SM). Needed for WalletConnect QR on fund / Lock. Browser wallets work without it. Allow `https://dev.githubbounties.xyz` and `http://localhost:3000` in the Reown dashboard. |

`--set-secrets` fails if the named secret has **no enabled version**.

Rotate: add a new SM version, then deploy a no-op revision (or re-submit this
build) so instances restart. See [gcp-bootstrap.md](gcp-bootstrap.md#rotate-secrets).

---

## 4. Find the live URL

```bash
gcloud run services describe github-bounties-web \
  --project=experiment-jegf --region=us-central1 \
  --format='value(status.url)'
```

Record that origin. Then create **`AUTH_URL`** in Secret Manager (stdin, never
echo) and attach it. Keep `AUTH_TRUST_HOST=true`.

```bash
URL="$(gcloud run services describe github-bounties-web \
  --project=experiment-jegf --region=us-central1 \
  --format='value(status.url)')"

gcloud secrets create AUTH_URL \
  --replication-policy=automatic \
  --labels=product=github-bounties,env=staging \
  --project=experiment-jegf || true
printf '%s' "${URL}" | gcloud secrets versions add AUTH_URL \
  --data-file=- --project=experiment-jegf

gcloud run services update github-bounties-web \
  --project=experiment-jegf --region=us-central1 \
  --update-secrets=AUTH_URL=AUTH_URL:latest \
  --update-env-vars="PUBLIC_BASE_URL=${URL}"
```

`printf` writes only to `gcloud` stdin. Do not `echo "$URL"` into chat or git.
The origin is also available from `gcloud run services describe` later.

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

`CRON_SECRET` is **not** required for smoke. `/api/jobs/expire-claim-locks`
stays callable without a bearer until Ops creates that secret and binds it.

---

## 5. Health smoke

Expect `200` and JSON (names only; never connection strings). With first-deploy
CDP secrets attached, `escrow.rail` should be `cdp` and `missing` empty:

```json
{
  "ok": true,
  "service": "github-bounties-web",
  "product": "GitHub Bounties",
  "fee_bps": 200,
  "claim_lock_hours": 72,
  "escrow": {
    "wired": true,
    "rail": "cdp",
    "network": "base-sepolia",
    "missing": [],
    "hosted_checkout": { "enabled": false }
  }
}
```

`escrow.hosted_checkout.enabled` stays `false`. Home (`GET /`) is the product
UI (HTML), not the hello JSON canary.

Hello canary (separate service): `GET /` and `GET /api/health` →
`service=github-bounties-hello`.

---

## Out of scope

- This PR does **not** run `gcloud --apply` against staging.
- Production marketing, V2 pool, load tests.
- Secret values in git or PR text.
