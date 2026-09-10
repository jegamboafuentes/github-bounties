# GitHub Bounties — GCP staging bootstrap

One-pager so V1 can deploy without archaeology. **GitHub Bounties** runs in GCP
project `experiment-jegf` (not Lightning Bounties / LB1 leftovers). Do **not** use
project id `github-bounties` / number `133702056111` (quota — cannot use that
project). V0-A (money ADR) and V0-B (webhooks) are separate; this file does not
change their product decisions.

## One-pager

| Field | Value |
| --- | --- |
| Product | **GitHub Bounties** |
| GCP project id | `experiment-jegf` |
| Project number | `42206083192` |
| Owner context | `enrique@lightningbounties.com` |
| Billing account name | `LB_MVP1_Billing_account` (human lock) |
| Billing account id | `011B0B-3BA3C5-CCE451` (what `gcloud billing` uses) |
| Labels | `product=github-bounties`, `env=staging` — set via `gcloud alpha projects update --update-labels` (not GA `gcloud projects update` on current SDK) |
| Region | **Hunch:** `us-central1` (ticket did not lock a region; override `GB_REGION`) |
| Artifact Registry | `us-central1-docker.pkg.dev/experiment-jegf/github-bounties` |
| Cloud Run hello | service `github-bounties-hello` — `GET /` and `GET /api/health` → 200 |
| Cloud SQL | instance `github-bounties-staging`, Postgres 16, **Enterprise** edition + `db-f1-micro` (not Enterprise Plus), DB `github_bounties` |
| Runtime SA | `github-bounties-runtime@experiment-jegf.iam.gserviceaccount.com` (SA id unchanged) |
| Build SA | `github-bounties-build@experiment-jegf.iam.gserviceaccount.com` |
| CI SA | `github-bounties-ci@experiment-jegf.iam.gserviceaccount.com` (Workload Identity later — **no user keys in git**) |

**Live Cloud Run URL:** not deployed from this environment. Do not invent a
`*.run.app` hostname. Blockers: [`docs/spikes/v0-c-gcp-bootstrap.md`](spikes/v0-c-gcp-bootstrap.md).

### Rotate secrets

1. Create a new Secret Manager **version** (do not overwrite git; there are no values in git).
2. Cloud Run picks up the latest version on the next revision if the service uses
   `--set-secrets=ENV=NAME:latest`. For a running revision, **deploy a no-op revision**
   or update the secret reference so instances restart.
3. After rotation: CDP keys in [CDP Portal](https://portal.cdp.coinbase.com/projects/api-keys);
   GitHub App webhook secret + PEM in the App settings; Google OAuth client in Cloud Console.
4. Never put `CDP_WALLET_SECRET`, `GITHUB_APP_PRIVATE_KEY`, or OAuth client secrets in
   frontend bundles, CI logs, or this repo.

Helpers: [`infra/gcloud`](../infra/gcloud) (primary) and [`infra/terraform`](../infra/terraform) (sketch).

---

## Checklist (checked vs blocked)

Evidence for this Cloud Agent VM: 2026-09-09. Re-run `./infra/gcloud/preflight.sh` on an Ops laptop.

| Item | Status | Evidence |
| --- | --- | --- |
| Staging project id recorded | **Done (docs)** | This file + README: `experiment-jegf` / `42206083192` |
| APIs listed + enable stub | **Done (stub)** | `infra/gcloud/bootstrap.sh`, `infra/terraform/main.tf` |
| Artifact Registry repo | **Blocked (live)** | `blocked: missing gcloud CLI / auth / billing` |
| Cloud SQL staging plan | **Done (docs)** | Plan below; instance **not** created |
| Secret names (empty OK) | **Done (stub)** | Names only; no versions; no values in git |
| Cloud Run hello code | **Done (local)** | `services/hello` — `npm test` → 200 on `/` and `/api/health` |
| Cloud Run hello **live URL** | **Blocked** | `blocked: missing gcloud auth / billing` — no `*.run.app` URL |
| IAM SA sketch | **Done (stub)** | Least-privilege runtime / build / CI; no JSON keys committed |
| Billing account | **Done (docs)** | name `LB_MVP1_Billing_account` (human lock) / id `011B0B-3BA3C5-CCE451` (`gcloud billing`) — live link still unverified |
| Labels applied on the project | **Blocked (live)** | `gcloud alpha projects update --update-labels` (not on GA `gcloud projects update` on current SDK); stub warns and continues if labels fail |
| Vertex / Looker / prod sizing | **Out** | Note only: do not request extra quotas in V0-C |

---

## 1. APIs to enable

```text
run.googleapis.com
sqladmin.googleapis.com
secretmanager.googleapis.com
cloudbuild.googleapis.com
artifactregistry.googleapis.com
iam.googleapis.com
```

Minimal dependencies (needed for private SQL, WIF, labels):

```text
iamcredentials.googleapis.com
cloudresourcemanager.googleapis.com
compute.googleapis.com
servicenetworking.googleapis.com
vpcaccess.googleapis.com
logging.googleapis.com
monitoring.googleapis.com
serviceusage.googleapis.com
sts.googleapis.com
```

Not enabled here: Vertex AI, Looker, GKE, extra GPU quotas.

```bash
gcloud config set project experiment-jegf
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com cloudresourcemanager.googleapis.com \
  compute.googleapis.com servicenetworking.googleapis.com \
  vpcaccess.googleapis.com logging.googleapis.com \
  monitoring.googleapis.com serviceusage.googleapis.com sts.googleapis.com
```

---

## 2. Artifact Registry

Docker repo `github-bounties` in `us-central1`:

```text
us-central1-docker.pkg.dev/experiment-jegf/github-bounties/github-bounties-hello
```

```bash
gcloud artifacts repositories create github-bounties \
  --repository-format=docker \
  --location=us-central1 \
  --description="GitHub Bounties container images (staging)" \
  --labels=product=github-bounties,env=staging
```

---

## 3. Cloud SQL Postgres (staging)

| Knob | Staging choice | Notes |
| --- | --- | --- |
| Instance | `github-bounties-staging` | New; not an LB1 clone |
| Version | Postgres **16** | **Hunch** (current GA) |
| Edition | **Enterprise** (`--edition=ENTERPRISE`) | Required for `db-f1-micro`. Do **not** use Enterprise Plus — SDK 584+ defaults create to Plus, which only accepts perf-optimized tiers. |
| Tier | `db-f1-micro` | Staging shared-core on Enterprise. If the API rejects it, try `db-g1-small` (still Enterprise, not Plus). |
| Disk | 10 GB SSD, zonal | No HA |
| DB / user | `github_bounties` / `gb_app` | Create user out-of-band; password is a secret |
| Network | **Private IP preferred** | Needs VPC + allocated range + `servicenetworking` peering |
| Interim | Public IPv4 + **require SSL** | Do **not** authorize `0.0.0.0/0`. Use Cloud SQL Auth Proxy or Cloud Run’s built-in unix socket |

**Reachability from Cloud Run**

- **Private IP (preferred):** Serverless VPC Access connector *or* Direct VPC egress on the same VPC. Next step if VPC/PSA is missing: create a VPC, allocate a `/16` (or `/20`) for Private Service Access, peer `servicenetworking.googleapis.com`, then re-run `sql-staging.sh --private`.
- **Interim public + SSL:** Cloud Run `--set-cloudsql-instances=experiment-jegf:us-central1:github-bounties-staging` and a unix-socket `DATABASE_URL`. Still `sslmode=require` for any public-IP clients (proxy).

`DATABASE_URL` shapes (password never in git):

```text
# Cloud Run unix socket (`localhost` is required so Node / postgres.js can parse
# the URL; the `host` query param still selects the Cloud SQL unix socket)
postgresql://gb_app:PASSWORD@localhost/github_bounties?host=/cloudsql/experiment-jegf:us-central1:github-bounties-staging

# Auth Proxy on localhost (laptop / sidecar)
postgresql://gb_app:PASSWORD@127.0.0.1:5432/github_bounties?sslmode=require
```

Script: `./infra/gcloud/sql-staging.sh` (dry-run) or `--apply`. Pass `--private` when the VPC is ready.

---

## 4. Secret Manager names

Create **empty secrets** (resource only, no versions). Values come later from CDP Portal,
GitHub App settings, Cloud SQL, and Google OAuth. Aligns with
[ADR 0001](adr/0001-cdp-x402-wallets.md) for `CDP_*`.

| Secret Manager id | Env var | Source | Required for |
| --- | --- | --- | --- |
| `DATABASE_URL` | `DATABASE_URL` | Cloud SQL (this ticket) | V1 API / ledger |
| `GITHUB_APP_PRIVATE_KEY` | `GITHUB_APP_PRIVATE_KEY` | GitHub App PEM (V0-B documents path locally) | GitHub API as the App |
| `GITHUB_WEBHOOK_SECRET` | `GITHUB_WEBHOOK_SECRET` | GitHub App webhook secret | HMAC on `/webhooks/github` |
| `CDP_API_KEY_ID` | `CDP_API_KEY_ID` | CDP Portal | Money path (ADR 0001) |
| `CDP_API_KEY_SECRET` | `CDP_API_KEY_SECRET` | CDP Portal | Money path |
| `CDP_WALLET_SECRET` | `CDP_WALLET_SECRET` | CDP Portal wallets | `gb-escrow` spend |
| `CDP_PROJECT_ID` | `CDP_PROJECT_ID` | CDP Portal (recommended in ADR) | Audit / SDK |
| `CDP_CLIENT_API_KEY` | `CDP_CLIENT_API_KEY` | Optional (Embedded Wallets later) | Not V1-blocking |
| `CDP_WEBHOOK_SECRET` | `CDP_WEBHOOK_SECRET` | When Coinbase webhooks are enabled | Verify CDP callbacks |
| `GOOGLE_OAUTH_CLIENT_ID` | `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud OAuth client (product login) | Google Sign-In later |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `GOOGLE_OAUTH_CLIENT_SECRET` | Same OAuth client | Google Sign-In later |

ADR also mentions `CDP_PAYMASTER_URL` (optional, not a V0-C placeholder).

V0-A uses these **unprefixed sandbox** names. Future prod: `prod-CDP_*` in a separate env — not this project’s job today.

```bash
for s in DATABASE_URL GITHUB_APP_PRIVATE_KEY GITHUB_WEBHOOK_SECRET \
  CDP_API_KEY_ID CDP_API_KEY_SECRET CDP_WALLET_SECRET CDP_PROJECT_ID \
  CDP_CLIENT_API_KEY CDP_WEBHOOK_SECRET \
  GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET
do
  gcloud secrets create "$s" --replication-policy=automatic \
    --labels=product=github-bounties,env=staging
done
```

Add a version later with `gcloud secrets versions add NAME --data-file=-` (stdin).
**Do not commit values.**

---

## 5. Cloud Run hello

Source: [`services/hello`](../services/hello) — tiny Node 22 server, not the product UI
and not the V0-B webhook app.

| Path | Response |
| --- | --- |
| `GET /` | 200 `{"ok":true,"service":"github-bounties-hello",...}` |
| `GET /api/health` | same 200 |
| anything else | 404 |

Local (no GCP):

```bash
cd services/hello && npm test && npm start
# curl -sS localhost:8080/api/health
```

Build + deploy stubs:

- Dockerfile: `services/hello/Dockerfile` (`PORT=8080`, user `node`)
- Cloud Build: [`cloudbuild.yaml`](../cloudbuild.yaml) — tags `:$BUILD_ID` and `:latest` (manual submit-safe). `$COMMIT_SHA` is empty unless a trigger set it or you pass it (see below).
- gcloud: `./infra/gcloud/deploy-hello.sh`

Manual Cloud Build (no trigger). Defaults are enough:

```bash
gcloud builds submit --project=experiment-jegf --config=cloudbuild.yaml .
```

Optional git SHA tag (built-in `COMMIT_SHA` is trigger-only; empty on a bare submit):

```bash
gcloud builds submit --project=experiment-jegf --config=cloudbuild.yaml \
  --substitutions=COMMIT_SHA=$(git rev-parse HEAD) .
```

`--allow-unauthenticated` is **only** for this health canary. V1 product API must not
stay fully public. Even with that flag, **unauthenticated GET may 403** when org
**Domain Restricted Sharing (DRS)** blocks `allUsers` as Cloud Run invoker. Do **not**
invent a public-access workaround if org policy forbids it. Probe with an identity
that has `roles/run.invoker` (or grant that role to testers):

```bash
URL="$(gcloud run services describe github-bounties-hello \
  --project=experiment-jegf --region=us-central1 --format='value(status.url)')"
# Unauth curl "$URL/" → 403 under DRS is expected.
curl -sS -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$URL/"
curl -sS -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$URL/api/health"
```

When V0-B’s webhook service lands, either point a second Cloud Run service at it or
replace this canary. Do not invent webhook URLs here.

---

## 6. IAM (least privilege, no user keys)

| SA | Roles | Why |
| --- | --- | --- |
| `github-bounties-runtime` | `secretmanager.secretAccessor`, `cloudsql.client`, `logging.logWriter` | Cloud Run process |
| `github-bounties-build` | `artifactregistry.writer`, `run.developer`, `logging.logWriter` + `iam.serviceAccountUser` **on runtime** | Cloud Build / image push / deploy |
| `github-bounties-ci` | same deploy shape as build + `cloudbuild.builds.editor` | GitHub Actions via **Workload Identity Federation** |

Do **not** download JSON keys for humans or CI. Bind GitHub as:

```text
principalSet://iam.googleapis.com/projects/42206083192/locations/global/workloadIdentityPools/github/attribute.repository/jegamboafuentes/github-bounties
```

(WIF pool name `github` is a **hunch** — create the pool/provider in console when CI is wired.)

Humans: `enrique@lightningbounties.com` is owner context. Break-glass Secret Manager
admin only; `roles/secretmanager.viewer` for everyone else who must see names.

Runtime should **not** have `roles/editor` or `roles/secretmanager.admin`.

---

## 7. Ops sequence (when credentials exist)

1. Confirm you can `gcloud projects describe experiment-jegf` as someone in the owner context.
2. Attach billing account `LB_MVP1_Billing_account` (`011B0B-3BA3C5-CCE451`) if the project is not already linked. Use the opaque id with `gcloud billing`; the display name is the human lock. Live Run/SQL/AR will fail without it.
3. `./infra/gcloud/preflight.sh` — must exit 0.
4. `./infra/gcloud/bootstrap.sh --apply` — project labels use `gcloud alpha projects update --update-labels` (current SDK; not GA `gcloud projects update`). A labels failure warns and continues.
5. `./infra/gcloud/sql-staging.sh --apply` (or `--apply --private` if VPC is ready).
6. Put real secret versions in Secret Manager (still not in git).
7. `./infra/gcloud/deploy-hello.sh --apply` **or** `gcloud builds submit --project=experiment-jegf --config=cloudbuild.yaml .` (optional `--substitutions=COMMIT_SHA=$(git rev-parse HEAD)`). Unauth 403 under DRS: use authenticated curl / `roles/run.invoker`, not a public IAM binding if org policy blocks `allUsers`.
8. Record the real `status.url` in this doc (replace the blocked line). Point GitHub App webhook at that host when V0-B is deployed.

Terraform equivalent: `infra/terraform` with `create_sql = false` until billing is on.

---

## Out of scope

- Production HA / bigger SQL tiers
- Looker, Vertex AI, extra model quotas (file a later ticket if V1 needs Gemini)
- Migrating any LB1 GCP resources
- Product UI, bounty features, live CDP calls, live GitHub App install
- Committing secrets or `DATABASE_URL` passwords
- Reworking ADR 0001 or the V0-B webhook PR

## Hunches (labeled)

- Region `us-central1` — not specified in the ticket.
- Postgres 16 + Enterprise edition + `db-f1-micro` — typical cheap staging; not Enterprise Plus. API may require `db-g1-small` on the same edition.
- Default VPC for private IP — may not have PSA peering; that is why public+SSL is the documented interim.
- WIF pool id `github` — not created yet.
- Hello service stays a separate Cloud Run canary from V0-B webhooks until someone merges the deployables.
