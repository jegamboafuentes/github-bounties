# V0-C spike: GCP bootstrap evidence

**Date:** 2026-09-09  
**Runbook:** [gcp-bootstrap.md](../gcp-bootstrap.md)  
**Product:** GitHub Bounties  
**Project:** `github-bounties` / `133702056111`

## Result: docs + stubs DONE; live GCP BLOCKED (expected)

This Cloud Agent VM has **no `gcloud` CLI**, **no Application Default Credentials**,
**no Docker**, and **billing owner TBD**. No Cloud Run URL was invented. No secrets
were created or committed.

### Exact blockers (live provision / deploy)

```bash
./infra/gcloud/preflight.sh
# exit 2
```

```
GitHub Bounties — V0-C GCP preflight
Project id:     github-bounties
Project number: 133702056111
Region:         us-central1

BLOCKED: live GCP bootstrap cannot run from this environment.
Exact blockers:
  - gcloud CLI is not installed (command not found)
  - no Application Default Credentials (ADC) on this machine

Do not invent Cloud Run / SQL URLs until the above are cleared.
```

Additional facts from the same VM:

| Probe | Result |
| --- | --- |
| `command -v gcloud` | `command not found` |
| `command -v docker` | `command not found` |
| `command -v terraform` | `command not found` |
| `GOOGLE_APPLICATION_CREDENTIALS` | unset |
| `~/.config/gcloud` | missing |
| GCE metadata `http://metadata.google.internal/...` | not available |
| Billing owner | **TBD** (cannot query `gcloud billing projects describe`) |

Unblock on an Ops machine as `enrique@lightningbounties.com` (or delegate):

1. Install Google Cloud SDK; `gcloud auth login` + `gcloud auth application-default login`.
2. Attach a billing account to `github-bounties` (owner still TBD in-repo).
3. `./infra/gcloud/preflight.sh` exits 0.
4. `./infra/gcloud/bootstrap.sh --apply` then SQL + hello deploy as in the runbook.
5. Paste the real Cloud Run `status.url` into `docs/gcp-bootstrap.md`.

### What *did* run (no GCP)

Hello canary (`services/hello`):

```bash
cd services/hello && npm test
# hello health: GET / and GET /api/health → 200
```

Local process (`PORT=8080`):

```
GET /            → 200 {"ok":true,"service":"github-bounties-hello","product":"GitHub Bounties","project":"github-bounties"}
GET /api/health  → 200 (same)
GET /nope        → 404
```

`./infra/gcloud/bootstrap.sh` (dry-run) prints enable-API, labels, AR, empty secret
creates, and IAM bindings without calling GCP.

### What we did **not** call

- `gcloud run deploy` / Cloud Build submit
- Cloud SQL instance create
- Secret Manager `versions add` (no values)
- Vertex AI, Looker, LB1 resource copy

### Secrets

No PEM blocks, `.env` files, or `*.tfstate` in this change. Placeholder **names** only.
