# Gcloud stubs for GitHub Bounties staging

Canonical runbook: [`docs/gcp-bootstrap.md`](../../docs/gcp-bootstrap.md)

| Script | What it does |
| --- | --- |
| `preflight.sh` | Read-only blocker report (exit 2 if live GCP is impossible) |
| `bootstrap.sh` | APIs, labels, Artifact Registry, empty secrets, SAs + IAM |
| `sql-staging.sh` | Cloud SQL Postgres 16 (Enterprise + `db-f1-micro`, public+SSL interim or `--private`) |
| `deploy-hello.sh` | Build/push/deploy `services/hello` to Cloud Run |

All mutating scripts default to **dry-run**. Pass `--apply` only on an authenticated machine with billing.

```bash
./infra/gcloud/preflight.sh
./infra/gcloud/bootstrap.sh           # prints commands
./infra/gcloud/bootstrap.sh --apply   # live
```
