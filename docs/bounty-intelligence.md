# Bounty issue body + intelligence (V3-0)

DEV-first. The bounty detail page (`/bounties/[id]`) shows the **full GitHub issue body** and a server-side **Gemini intelligence** card. PROD is not wired. Pool Claim / hosted checkout are unchanged.

## Issue body

Create already snapshots the GitHub issue via the App installation token (`fetchIssue` in `apps/web/src/github/api.ts`). V3-0:

- Stores the full body in `bounties.description_snapshot` (GitHub’s 65,536 character cap — no 4k clip).
- Sets `bounties.issue_body_synced_at` when the snapshot came from GitHub.
- On detail read, refetches when the snapshot is missing, looks like the old 4k clip, `issue_body_synced_at` is null (legacy rows), or the snapshot is older than **24 hours**.
- Renders markdown as sanitized HTML (raw HTML escaped; `http`/`https`/`mailto` links only; images `https` only).

No second OAuth path. Failures fall back to the stored snapshot and do not crash the page.

## Intelligence card

Server-only. Reads `process.env.GEMINI_API_KEY` (Secret Manager / Cloud Run). **Never** `NEXT_PUBLIC_*`.

Analyzes, grounded in the fetched issue body + repo metadata (GitHub about, languages, README blurb):

- repo about
- language / stack
- complexity **S / M / L**

UI labels the output **AI estimate — not a guarantee**.

### Refresh / cache

Table `bounty_intelligence`, keyed by `bounty_id`.

| When | What happens |
| --- | --- |
| **Create** | Issue body is stored. Intelligence is generated on the **first successful detail read** (so posting a bounty is not blocked on Gemini). |
| **Stale TTL** | Ready rows: **7 days**. Error rows: **1 hour** (avoid hammering Gemini). |
| **Source change** | SHA-256 fingerprint of issue body + repo about + languages + README blurb. Mismatch regenerates. |
| **Manual** | `GET /bounties/[id]?refreshIntelligence=1` forces a new Gemini call when the key is set. |

Missing `GEMINI_API_KEY`: no Gemini call, no cache write, card shows **Intelligence unavailable**. The rest of the bounty page still works.

Gemini HTTP/parse failures: cache `status=error` for the error TTL, same degrade copy.

Optional `GEMINI_MODEL` (default `gemini-2.5-flash`). Server-only.

## Ops (DEV remount)

`GEMINI_API_KEY` is a `WEB_OPTIONAL_SECRET` in [`infra/gcloud/config.sh`](../infra/gcloud/config.sh). `deploy-web.sh` attaches `GEMINI_API_KEY=GEMINI_API_KEY:latest` when Secret Manager has an enabled version (already true on DEV `github-bounties-web`) and **skips cleanly** when absent. Distinct from `WEB_SKIP_SECRETS` (`CRON_SECRET` / `CDP_WEBHOOK_SECRET` / `AUTH_URL`), which stay off unless `GB_ATTACH_OPTIONAL_SECRETS=1`.

Do not add `GEMINI_API_KEY` to the required first-deploy `--set-secrets` list — a named secret with 0 versions fails the deploy. **PROD is not wired.**
