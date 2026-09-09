# Minimal Cloud Run canary for GitHub Bounties staging.

Not the product UI, bounty API, or V0-B webhook stub. Serves:

- `GET /` → 200 JSON
- `GET /api/health` → 200 JSON

```bash
npm start          # PORT=8080
npm test           # local 200 checks
```

Live deploy: [`docs/gcp-bootstrap.md`](../../docs/gcp-bootstrap.md). Cloud Build tags `:$BUILD_ID` and `:latest` (optional `COMMIT_SHA`). Unauth 403 under Domain Restricted Sharing is expected — use authenticated curl or `roles/run.invoker`, not a public invoker binding if org policy blocks `allUsers`.
