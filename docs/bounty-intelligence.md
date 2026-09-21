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

When the card cannot run, it still says **Intelligence unavailable** and adds a safe reason (no secrets):

| Reason | Meaning |
| --- | --- |
| `missing_key` | `GEMINI_API_KEY` is unset in the process env |
| `error · missing_table` | migrate `0005_bounty_intelligence` has not been applied (`bounty_intelligence` missing) |
| `error · gemini_http_XXX` | Gemini HTTP status (404 / 429 / 403 / …) |
| `error · gemini_parse` | Model returned JSON that failed the S/M/L schema |
| `error · gemini_timeout` | Gemini call aborted after 12s |
| `error · gemini_fetch` | Network / fetch failure (egress) |

Cloud Run logs `console.error` JSON (`bounty_intelligence_cache_read_failed` / `_cache_write_failed` / `_gemini_failed`) with `bountyId`, `error`, `pgCode`, `model` — never the API key. Cache write failure after a successful Gemini call still **shows the card** (ready) and logs the table miss.

`GET /api/health` → `intelligence.configured` is `true` when `GEMINI_API_KEY` is set (boolean only).

### Refresh / cache

Table `bounty_intelligence`, keyed by `bounty_id`.

| When | What happens |
| --- | --- |
| **Create** | Issue body is stored. Intelligence is generated on the **first successful detail read** (so posting a bounty is not blocked on Gemini). |
| **Stale TTL** | Ready rows: **7 days**. Error rows: **1 hour** (avoid hammering Gemini). |
| **Source change** | SHA-256 fingerprint of issue body + repo about + languages + README blurb. Mismatch regenerates. |
| **Manual** | `GET /bounties/[id]?refreshIntelligence=1` skips the error/ready cache and retries Gemini when the key is set. |

Missing `GEMINI_API_KEY`: no Gemini call, no cache write, card shows **Intelligence unavailable** / `missing_key`. The rest of the bounty page still works.

Optional `GEMINI_MODEL` (default `gemini-2.5-flash`). Server-only. Override if a key cannot call that model.

### Board

Ready rows (`status=ready`) show small complexity (S/M/L) and language/stack badges on `/board`. Missing or error cache **hides the badge** (no “unknown”). Filters for complexity and language **exclude** bounties with no ready intel.

## Ops (DEV remount)

**Apply migrate `0005_bounty_intelligence` as part of the V3-0 remount.** That creates `bounty_intelligence` and `bounties.issue_body_synced_at`. Mounting `GEMINI_API_KEY` without this migrate is not enough — the card degrades with `missing_table`.

```bash
./infra/gcloud/migrate-staging.sh --apply
```

`GEMINI_API_KEY` is a `WEB_OPTIONAL_SECRET` in [`infra/gcloud/config.sh`](../infra/gcloud/config.sh). `deploy-web.sh` attaches `GEMINI_API_KEY=GEMINI_API_KEY:latest` when Secret Manager has an enabled version (already true on DEV `github-bounties-web`) and **skips cleanly** when absent. Distinct from `WEB_SKIP_SECRETS` (`CRON_SECRET` / `CDP_WEBHOOK_SECRET` / `AUTH_URL`), which stay off unless `GB_ATTACH_OPTIONAL_SECRETS=1`.

Do not add `GEMINI_API_KEY` to the required first-deploy `--set-secrets` list — a named secret with 0 versions fails the deploy. **PROD is not wired.**

The header shows a small **DEV** pill on `dev.githubbounties.xyz` (and Cloud Run service `github-bounties-web`). It does **not** show on apex `githubbounties.xyz` or `github-bounties-web-prod`.
