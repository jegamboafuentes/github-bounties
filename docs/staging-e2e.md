# Staging E2E runbook — closed beta (V1-7)

Manual checklist after Ops deploys `github-bounties-web` per
[`staging-deploy.md`](staging-deploy.md). Official name: **GitHub Bounties**.
This is not Lightning Bounties / LB1. No production marketing. No V2 pool.
No load tests.

Sepolia or mock USDC is OK. **Do not** enable Base mainnet
(`CDP_ALLOW_MAINNET=1`) for closed beta.

---

## Staging URLs (placeholders)

Fill these from `gcloud run services describe` after deploy. **Do not invent**
a `*.run.app` host in a PR.

| Surface | Placeholder | Auth |
| --- | --- | --- |
| Origin | `https://<github-bounties-web-host>` | DRS may require identity |
| Health | `{ORIGIN}/api/health` | invoker / identity token if DRS |
| Home | `{ORIGIN}/` | public if ingress allows |
| Sign in | `{ORIGIN}/signin` | Google |
| Settings | `{ORIGIN}/settings` | Google session |
| Board | `{ORIGIN}/board` | public read |
| New bounty | `{ORIGIN}/bounties/new` | Google |
| Bounty | `{ORIGIN}/bounties/<id>` | public read; Google for actions |
| GitHub webhook | `{ORIGIN}/webhooks/github` | HMAC |
| GitHub setup / callback | `{ORIGIN}/github/setup`, `/github/callback` | Google |
| Expire locks | `{ORIGIN}/api/jobs/expire-claim-locks` | optional `CRON_SECRET` |
| Hello canary (not product) | hello `status.url` `/api/health` | separate service |

Record:

```text
WEB_ORIGIN=
HELLO_ORIGIN=
GOOGLE_OAUTH_REDIRECT={WEB_ORIGIN}/api/auth/callback/google
GITHUB_WEBHOOK={WEB_ORIGIN}/webhooks/github
```

---

## Closed-beta actors

| Role | Needs |
| --- | --- |
| Poster | Google account, App-connected test repo, funded issue `#N` |
| Hunter | Google account **linked** via Connect GitHub (`github_links`), BYO Base address (`0x` + 40 hex) |
| Ops | `gcloud` on `experiment-jegf`, Secret Manager admin/break-glass, Cloud Run logs |

Use a **private test repo**. Prefer Base Sepolia test USDC. Mock rail is acceptable
when CDP secrets are unset (`GET /api/health` → `escrow.rail=mock` + `missing` names).

---

## Health smoke (do this first)

```bash
URL="$(gcloud run services describe github-bounties-web \
  --project=experiment-jegf --region=us-central1 \
  --format='value(status.url)')"
curl -sS -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$URL/api/health"
```

Pass when:

- [ ] HTTP 200
- [ ] `ok: true`, `service: github-bounties-web`, `fee_bps: 200`, `claim_lock_hours: 72`
- [ ] `escrow.network` is `base-sepolia` (or documented override — not `base` unless gated)
- [ ] `escrow.rail` is `mock` or `cdp` (if mock, `escrow.missing` lists exact CDP names)
- [ ] `escrow.hosted_checkout.enabled` is `false`
- [ ] Response does **not** contain secret values or connection strings

Unauth `curl "$URL/api/health"` → **403** under Domain Restricted Sharing is
expected. Do not “fix” that with a public binding if org policy blocks `allUsers`.

---

## Happy path

Work a **new** funded issue (not a leftover seed row unless Ops seeded staging on
purpose). Lock ≠ money. Merge is truth. Hunter payout is net of **2%**.

### 1. Google sign-in

- [ ] Open `{ORIGIN}/signin` → **Continue with Google**
- [ ] After consent, header shows the session; `{ORIGIN}/settings` loads
- [ ] `GET {ORIGIN}/api/me` with the session cookie returns the user (`google_sub` persisted)
- [ ] **Sign out** clears the cookie; `/settings` redirects to sign-in

If `/signin` lists missing env **names** (`AUTH_SECRET`, `GOOGLE_OAUTH_*`,
`DATABASE_URL`), stop and add Secret Manager versions. Never paste values here.

### 2. Connect GitHub

- [ ] Settings → **Connect GitHub** → install the staging App on the test repo
- [ ] `{ORIGIN}/github/setup` confirms `installation_id` (do not trust the query param alone)
- [ ] `{ORIGIN}/github/callback` writes `github_links` for this Google user
- [ ] Settings shows the linked GitHub login (hunter **and** poster should link)

### 3. Board + post

- [ ] `{ORIGIN}/board` lists bounties (filters by repo / status work)
- [ ] `{ORIGIN}/bounties/new` (signed in): paste a GitHub issue URL on an App-connected repo
- [ ] Submit creates `pending_fund`; detail page `{ORIGIN}/bounties/<id>` exists

### 4. Fund (escrow lock)

- [ ] Poster: **Lock in escrow** on the bounty page
- [ ] Status becomes `funded` / board shows funded
- [ ] Live CDP: `escrows.fund_tx_hash` is a real Sepolia hash
- [ ] Mock: hash is `mock:0x…` and the UI lists the exact missing `CDP_*` names

Hosted checkout stays **disabled**. Do not treat a Coinbase checkout redirect as funded.

### 5. Claim-lock (72h, not money)

- [ ] Hunter: take the exclusive **72h** claim-lock
- [ ] Board shows **Claimed by X until …**
- [ ] Second hunter cannot take the same lock
- [ ] Optional: issue comment / `bounty-claimed` label (best-effort; GitHub errors must not roll back the lock)

### 6. Merge → eligible

- [ ] Hunter opens a PR that closes funded `#N` (`Fixes #N` / equivalent) into the default branch
- [ ] Merge the PR
- [ ] `POST /webhooks/github` returns 200; GitHub Recent deliveries is green
- [ ] One `claims` row with `status=eligible` for the merged PR author
- [ ] Board / bounty page shows payout-eligible for that hunter

### 7. Claim payout (net of 2%)

Face `F`, fee `floor(F × 0.02)`, hunter `F − fee` (example: 100 / 2 / 98).

- [ ] Eligible hunter enters a BYO Base address (`0x` + 40 hex; not zero, not ENS)
- [ ] **Claim … USDC** succeeds
- [ ] UI shows face / 2% fee / net / payout tx
- [ ] Board: **Completed (paid)**
- [ ] `claims.status=paid`, `bounties.status=settled`
- [ ] Poster (or anyone else) calling claim gets a clear `not_hunter` error; bounty stays paid (idempotent hunter retry is OK)

---

## Failure drills

### Duplicate webhook

- [ ] GitHub App → Advanced → Recent deliveries → **Redeliver** the merge delivery (same `X-GitHub-Delivery`)
- [ ] Response 200 with `duplicate: true`
- [ ] Still **one** `claims` row for `(bounty_id, pr_number)`
- [ ] Logs: `[idempotency] skip duplicate delivery <guid>` (Cloud Run logs)

### Expired lock

- [ ] On a **different** funded bounty, take a claim-lock
- [ ] Expire it: wait 72h **or** call `{ORIGIN}/api/jobs/expire-claim-locks` (Bearer `CRON_SECRET` if set) **or** `cd apps/web && npm run expire-locks` against staging via proxy (secret-safe, same as migrate)
- [ ] Lock status `expired`; bounty returns to `funded` (not refunded)
- [ ] Merge of a closing PR still marks the merged author eligible (lock ≠ money)

### Refund

- [ ] Poster **Cancel and refund** on a funded, unmerged bounty
- [ ] Full face returns (no 2% on refund)
- [ ] `escrows.status=refunded`; bounty cancelled
- [ ] Mock: `mock:` refund hash + missing CDP names if applicable

---

## Sepolia vs Base gates

| Flag / secret | Closed beta |
| --- | --- |
| `CDP_NETWORK` | `base-sepolia` (default) |
| `CDP_ALLOW_MAINNET` | **unset** |
| `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` + `CDP_WALLET_SECRET` | optional; mock if any missing |
| `CDP_WEBHOOK_SECRET` | may be empty |
| `CDP_DRY_RUN_LIVE=1` | laptop Sepolia faucet only ([escrow.md](escrow.md)); not required for mock E2E |

- [ ] Health shows `mainnet_refused: true` if someone set a mainnet alias without the allow flag
- [ ] Do not run closed beta against `CDP_NETWORK=base`

---

## Observability (names / ids only)

| Signal | Where |
| --- | --- |
| Request logs | Cloud Run service `github-bounties-web` → Logs (`severity>=ERROR` first) |
| Deploy revisions | `gcloud run revisions list --service=github-bounties-web --region=us-central1` |
| Migrate job | `github-bounties-migrate` job logs |
| Webhook HMAC / replay | GitHub App → Advanced → Recent deliveries (red/green, delivery GUID) |
| Eligibility / duplicate | Cloud Run log lines + table `webhook_deliveries.delivery_id` |
| Escrow | `escrows.*_tx_hash`, `fee_ledger.fee_bps=200`, health `escrow.rail` |
| Sessions | Auth.js `__Secure-authjs.session-token` (httpOnly; do not dump cookies) |
| SQL | Cloud SQL `github-bounties-staging` query insights; no passwords in screenshots |

Never paste `DATABASE_URL`, PEMs, OAuth client secrets, or CDP keys into tickets,
chat, or screenshots.

---

## Abort / escalate

Stop the beta and ping Ops if:

- Health is not 200 or `service` is not `github-bounties-web`
- Sign-in or Connect GitHub lists missing env names
- Webhooks 503 (`missing_github_webhook_secret`) or 401 (bad HMAC)
- Mainnet rail is active
- A secret value appeared in logs

Hello canary remaining up (`github-bounties-hello`) does **not** mean the product
is healthy.
