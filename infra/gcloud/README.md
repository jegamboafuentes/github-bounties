# Gcloud stubs for GitHub Bounties staging

Canonical runbook: [`docs/gcp-bootstrap.md`](../../docs/gcp-bootstrap.md)

| Script | What it does |
| --- | --- |
| `preflight.sh` | Read-only blocker report (exit 2 if live GCP is impossible) |
| `bootstrap.sh` | APIs, labels, Artifact Registry, empty secrets, SAs + IAM |
| `sql-staging.sh` | Cloud SQL Postgres 16 (Enterprise + `db-f1-micro`, public+SSL interim or `--private`) |
| `list-secret-versions.sh` | Names + whether an enabled version exists (never prints values) |
| `migrate-staging.sh` | Drizzle migrate via Auth Proxy or Cloud Run Job (`DATABASE_URL` from SM) |
| `deploy-hello.sh` | Build/push/deploy `services/hello` to Cloud Run |
| `deploy-web.sh` | Build/push/deploy `apps/web` to `github-bounties-web` (hello untouched) |

V1-7 Ops runbooks: [`docs/staging-deploy.md`](../../docs/staging-deploy.md),
[`docs/staging-e2e.md`](../../docs/staging-e2e.md). Web Cloud Build:
[`cloudbuild.web.yaml`](../../cloudbuild.web.yaml) (hello stays on
[`cloudbuild.yaml`](../../cloudbuild.yaml)).

All mutating scripts default to **dry-run**. Pass `--apply` only on an authenticated machine with billing.

```bash
./infra/gcloud/preflight.sh
./infra/gcloud/bootstrap.sh           # prints commands
./infra/gcloud/bootstrap.sh --apply   # live
```
