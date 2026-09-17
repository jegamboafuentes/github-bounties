# Staging E2E runbook — closed beta (V1-7) + V2-5 DEV dogfood

Manual checklist after Ops deploys `github-bounties-web` per
[`staging-deploy.md`](staging-deploy.md). Official name: **GitHub Bounties**.
This is not Lightning Bounties / LB1. No production marketing. No load tests.

V2 pool (ADR 0003) is on DEV after V2-4 (`claim_lock_sunset: true`). **V2-5**
live multi-browser dogfood is **deferred to Enrique**; the runbook is in this
file ([§ V2-5](#v2-5--dev-dogfood-checklist-ready--live-pending-enrique)).
Do not wait on that live run from Eng.

Sepolia USDC is OK. **Do not** enable Base mainnet
(`CDP_ALLOW_MAINNET=1`). **Do not** use production user funds.

---

## Staging URLs (placeholders)

Fill these from `gcloud run services describe` after deploy. **Do not invent**
a `*.run.app` host in a PR.

| Surface | Placeholder | Auth |
| --- | --- | --- |
| Origin | `https://<github-bounties-web-host>` | DRS may require identity |
| Public DEV | `https://dev.githubbounties.xyz` | browser; V2-5 dogfood origin |
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

Use a **private test repo**. First-deploy binds CDP keys that already have SM
versions — expect `escrow.rail=cdp` on `base-sepolia`. Mock is only if those
secrets are later detached. **Do not** set `CDP_ALLOW_MAINNET=1`.
`CRON_SECRET` is not in SM; expire-locks smoke does not need a bearer.

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
- [ ] `ok: true`, `service: github-bounties-web`, `fee_bps: 200`, `claim_lock_hours: 72`, `claim_lock_sunset: true`
- [ ] `escrow.network` is `base-sepolia` (or documented override — not `base` unless gated)
- [ ] `escrow.rail` is `cdp` and `escrow.missing` is empty (first-deploy CDP secrets are bound)
- [ ] If someone detached CDP secrets: `rail=mock` and `missing` lists exact names only
- [ ] `escrow.hosted_checkout.enabled` is `false`
- [ ] `escrow.x402_exact.scheme` is `exact` and `hostedCheckout` is `disabled`
- [ ] Response does **not** contain secret values or connection strings

Unauth `curl "$URL/api/health"` → **403** under Domain Restricted Sharing is
expected. Do not “fix” that with a public binding if org policy blocks `allUsers`.

---

## Happy path

Work a **new** funded issue (not a leftover seed row unless Ops seeded staging on
purpose). Signals ≠ money. Merge is truth. Winner share is ADR 0003 (empty pool = 98% of face).

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

Preferred on DEV (no hash paste):

- [ ] `GET {ORIGIN}/api/bounties/<id>/x402` → **402** `exact` to `gb-escrow`
- [ ] Settle with an x402 client (Base Sepolia test USDC) → inbound recorded
- [ ] Poster: **Lock in escrow** with the hash field empty → `funded`

Fallback (unchanged):

- [ ] Poster: paste a direct-transfer `fundTxHash` then **Lock in escrow**
- [ ] Status becomes `funded` / board shows funded
- [ ] Live CDP: `escrows.fund_tx_hash` is a real Sepolia hash
- [ ] Mock: hash is `mock:0x…` and the UI lists the exact missing `CDP_*` names

Hosted checkout stays **disabled**. Do not treat a Coinbase checkout redirect as funded.

### 5. Parallel hunt (no exclusive 72h lock)

- [ ] Board / detail do **not** show **Claimed by X until …**
- [ ] There is no **Claim for 72h** button
- [ ] Signed-in hunter: **Working on this** (non-blocking). A second hunter can signal the same bounty
- [ ] Clear signal works; it does not change eligibility or money
- [ ] Residual V1 exclusive locks drain on read or `{ORIGIN}/api/jobs/expire-claim-locks` (`claim_lock_sunset: true`); bounty returns to `funded` (not refunded)
- [ ] `expires_at` bounty refunds still run from the same cron

### 6. Merge → eligible

- [ ] Hunter opens a PR that closes funded `#N` (`Fixes #N` / equivalent) into the default branch
- [ ] Merge the PR
- [ ] `POST /webhooks/github` returns 200; GitHub Recent deliveries is green
- [ ] One `claims` row with `status=eligible` for the merged PR author
- [ ] Board / bounty page shows payout-eligible for that hunter

### 7. Claim payout (ADR 0003 split)

Face `F`, fee `floor(F × 0.02)`, winner ≈83.3% of face when the pool is non-empty, or **100% of post-fee** when `E` is empty (example empty-pool: 100 / 2 / 98).

- [ ] Eligible winner enters a BYO Base address (`0x` + 40 hex; not zero, not ENS)
- [ ] **Claim … USDC** succeeds
- [ ] UI shows face / 2% fee / winner / pool / each share / tx hashes
- [ ] Board: **Completed (paid)**
- [ ] `claims.status=paid`, `bounties.status=settled` (or `settled_partial` if a pool wallet is missing)
- [ ] Poster (or anyone else) calling claim gets a clear `not_hunter` error; they can still see roster + breakdown
- [ ] Pool members are paid to Settings wallets that exist; unlinked members show Connect GitHub

---

## Failure drills

### Duplicate webhook

- [ ] GitHub App → Advanced → Recent deliveries → **Redeliver** the merge delivery (same `X-GitHub-Delivery`)
- [ ] Response 200 with `duplicate: true`
- [ ] Still **one** `claims` row for `(bounty_id, pr_number)`
- [ ] Logs: `[idempotency] skip duplicate delivery <guid>` (Cloud Run logs)

### Expired lock

- [ ] Residual exclusive lock (if any leftover V1 row): call `{ORIGIN}/api/jobs/expire-claim-locks` (Bearer `CRON_SECRET` if set) **or** `cd apps/web && npm run expire-locks` against staging via proxy (secret-safe, same as migrate) **or** open `/board` (drain on read)
- [ ] Lock status `expired` or `released`; bounty returns to `funded` (not refunded)
- [ ] Merge of a closing PR still marks the merged author eligible (signals ≠ money)

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
| Eligibility / duplicate | Cloud Run log lines + `webhook_deliveries.delivery_id` + `claim_results` / `winner_login` |
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

---

## V2-5 — DEV dogfood (checklist ready / live pending Enrique)

Meet the product done bar on `https://dev.githubbounties.xyz` per
[v2-tickets.md](v2-tickets.md) § V2-5 and [ADR 0003](adr/0003-v2-multi-hunter-pool.md).

**Eng status:** runbook shipped. **Live multi-browser dogfood is deferred to
Enrique** (poster + hunters below). Cloud Agents / Ops must **not** execute
this section and must **not** wait on it. After Enrique runs it, fill the
[live log](#v2-5-live-log-enrique-fills) — that is the empty-pool regression
record.

**DEV only.** No Base mainnet. No production user funds. Do **not** set
`CDP_ALLOW_MAINNET=1`. Sepolia test USDC only.

### Current DEV remount (2026-09-17)

Confirmed on the V2-4 remount **before** this runbook lands. After a later
V2-5 remount, record the new revision in the live log; `claim_lock_sunset`
stays `true` and `escrow.ticket` becomes `V2-5`.

| Item | Value |
| --- | --- |
| Origin | `https://dev.githubbounties.xyz` |
| Cloud Run service | `github-bounties-web` (`experiment-jegf`, `us-central1`) |
| Revision | `github-bounties-web-00037-ckz` |
| Git tip | `cfd7021` (V2-4 [#40](https://github.com/jegamboafuentes/github-bounties/pull/40) remount GREEN 2026-09-17) |
| Migrate | `0004_v2_pool_participants` **already applied** — do **not** re-run migrate for dogfood |
| Health | `claim_lock_sunset: true` confirmed; `fee_bps: 200`; `escrow.rail: cdp`; `escrow.network: base-sepolia` |
| Hosted checkout | disabled |
| Exclusive lock | not required (`CLAIM_LOCK_SUNSET`) |

```bash
curl -sS https://dev.githubbounties.xyz/api/health
# expect claim_lock_sunset: true, escrow.network: base-sepolia, escrow.rail: cdp
# after V2-5 remount: escrow.ticket: "V2-5"
```

### Actors Enrique plans

Three **distinct GitHub identities**. Prefer three browser profiles (or
devices) so Google sessions and `github_links` do not collide. Settings →
Disconnect then Connect GitHub if a profile must switch logins
([github-app.md](github-app.md#disconnect-vs-app-uninstall)).

| Role | GitHub login | Needs |
| --- | --- | --- |
| Poster | `jegamboafuentes` | Google session, App-connected **private test repo**, Base Sepolia test USDC to fund |
| Hunter A | `enrique-lb` | Google session **linked** as `enrique-lb` (`github_links`), BYO Base Sepolia address (`0x` + 40 hex) |
| Hunter B | `enrique-mp` | Same as A, linked as `enrique-mp`. Neither hunter is the poster |

Pool members are `enrique-lb` and `enrique-mp`. The **winner** (merged PR
author who closes `#N`) must **not** be those two if the roster must show
**winner + both pool members**. On these accounts, the practical closer is
poster `jegamboafuentes` (`Fixes #N`). Poster is excluded from `E` and can
still be the winner (ADR 0003). A third hunter identity is OK if Enrique has
one; do not put the poster in `E`.

Use a **private test repo** with the staging GitHub App installed. Work
**new** funded issues — not leftover seed rows (`#50` / `#52` are local seed).

### Face amounts (ADR 0003)

Prefer face **100.000000** USDC (Sepolia) so the split is the PM vector.
If the faucet is tight, use **1.000000** and the 1 USDC row instead.

| face | \|E\| | fee → `gb-fee` | winner | pool total | each |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100.000000 | 2 | 2.000000 | 83.300000 | 14.700000 | 7.350000 |
| 100.000000 | 0 | 2.000000 | **98.000000** | 0 | — |
| 1.000000 | 2 | 0.020000 | 0.833000 | 0.147000 | 0.073500 |
| 1.000000 | 0 | 0.020000 | **0.980000** | 0 | — |

Conservation: `fee + winner + N × each = face`. Explorer:
`https://sepolia.basescan.org/tx/<hash>` (Base Sepolia only).

### Preflight (before any live money)

- [ ] `GET https://dev.githubbounties.xyz/api/health` → 200, `ok: true`,
      `service: github-bounties-web`, `fee_bps: 200`, `claim_lock_sunset: true`
- [ ] `escrow.network` is `base-sepolia`, `escrow.rail` is `cdp`, `missing` is `[]`
- [ ] `escrow.hosted_checkout.enabled` is `false`; `mainnet_refused` is not hiding a live `base` rail
- [ ] `CDP_ALLOW_MAINNET` is **unset**. Do not fund or settle on Base mainnet
- [ ] Migrate `0004` already applied (no `db:migrate` for this dogfood)
- [ ] Board does **not** show **Claimed by X until …** and has no **Claim for 72h**
- [ ] Each actor: Google sign-in → Connect GitHub as the login in the table → Settings BYO Base address (hunters + whoever will Claim)
- [ ] Staging App is installed on the private test repo; webhook Recent deliveries can be opened

### Scenario A — ≥2 hunters, pool split, signal does not block

Poster funds issue `#N`. Both named hunters open a qualifying PR **before**
the winning merge. Exclusive lock is **not** used.

1. **Post + fund (poster `jegamboafuentes`)**
   - [ ] `{ORIGIN}/bounties/new`: paste a GitHub issue URL on the App-connected test repo
   - [ ] x402 `exact` Lock to `gb-escrow` (Base Sepolia test USDC) → bounty `funded`
   - [ ] Record `BOUNTY_ID`, issue `#N`, face

2. **Signal (hunter A `enrique-lb`)**
   - [ ] Signed in as `enrique-lb`, open `{ORIGIN}/bounties/<id>`
   - [ ] **Working on this** — non-blocking; board/detail show the signal
   - [ ] There is still no exclusive lock. Clear is optional; do **not** treat the signal as eligibility

3. **Qualifying PRs (both hunters, before winning merge)**
   - [ ] `enrique-lb`: open a PR that **references** `#N` (`Refs #N` / `Related to #N` / title `#N`) with **≥1 commit of theirs**. Draft OK. Fork OK. Prefer **not** a closer so this PR does not win
   - [ ] `enrique-mp`: still able to open a second qualifying PR (`Refs #N` + ≥1 own commit) **after** A signaled — signal must not serialize hunt
   - [ ] Each PR exists **before** the winning merge (`created_at < merged_at`)
   - [ ] Neither qualifying author is the poster

4. **Winning merge (closes `#N`; exclusive lock not required)**
   - [ ] Closer (poster `jegamboafuentes`, or a third hunter — **not** `enrique-lb` / `enrique-mp` if both must stay in the pool) opens + merges `Fixes #N` (or equivalent closer) into the **default** branch
   - [ ] GitHub App → Advanced → Recent deliveries is green (`pull_request` closed/merged)
   - [ ] Bounty detail **Pool roster** shows **Winner** + **both** pool members (`enrique-lb`, `enrique-mp`), each with qualifying PR
   - [ ] Copy says eligibility is frozen at the winning merge
   - [ ] Board / detail never required **Claim for 72h** / **Claimed by X until …**

5. **Settle on DEV (Base Sepolia)**
   - [ ] Both pool members already have Settings wallets (missing wallet → that `POOL_PAYOUT` stays retryable; **do not** redistribute)
   - [ ] Winner (merged PR author, Google-linked as that login) **Claim … USDC** on the bounty page (BYO Base). Settle pays `FEE_OUT` + `WINNER_PAYOUT` + `POOL_PAYOUT` × 2
   - [ ] Payout breakdown: face / fee 2% / winner ≈83.3% / pool ≈14.7% / each equal share — matches the table for the face you used
   - [ ] Confirmed txs for **fee**, **winner**, and **each** pool member. Bounty page lists each `tx <hash>` — open `https://sepolia.basescan.org/tx/<hash>` (or the page hyperlink if present)
   - [ ] Board: **Completed (paid)**. `claims.status=paid` for the winner only (pool members are not `claims` rows)

### Scenario B — empty-pool regression (record here)

Second **new** funded bounty. **No** other qualifying hunters — only the
winning closer. This is the empty-pool regression (`|E|=0`).

- [ ] Poster funds a **different** issue `#M` (same DEV, Base Sepolia, not mainnet)
- [ ] Do **not** open `Refs #M` PRs from `enrique-lb` / `enrique-mp` (or anyone else)
- [ ] One hunter (recommend `enrique-lb`) opens + merges `Fixes #M` with ≥1 own commit. Poster must not also hunt this issue
- [ ] Roster: winner only; pool empty (copy: winner receives **100% of post-fee**)
- [ ] Winner Claim: fee 2% + winner **100% of post-fee** (example `100` → fee `2` + winner `98`). Breakdown shows `0` pool
- [ ] Confirmed txs: **fee** + **winner** only. **No** `POOL_PAYOUT` transfers — no pool hashes on the bounty page, no extra Sepolia txs to pool wallets
- [ ] Fill the Scenario B rows in the [live log](#v2-5-live-log-enrique-fills) below — that is the recorded empty-pool regression

### Abort / escalate (V2-5)

Stop and ping Ops if:

- Health shows `escrow.network` of `base` or `CDP_ALLOW_MAINNET=1` would be required
- A bounty is funded or settled with **production** / mainnet USDC
- Exclusive 72h lock is required to open a second hunter PR
- A signal blocks `enrique-mp` from opening a PR or from being paid
- Empty-pool settle sends any `POOL_PAYOUT` or winner amount ≠ post-fee
- `|E|=2` amounts do not match ADR 0003 (100 → 2 / 83.30 / 14.70 / 7.35)

### V2-5 live log (Enrique fills)

Leave blank until the live run. Do not invent hashes in a PR.

```text
# Preflight
DATE=
WEB_ORIGIN=https://dev.githubbounties.xyz
REVISION=                 # e.g. github-bounties-web-00037-ckz or post-V2-5 remount
GIT_TIP=                  # was cfd7021 on 00037-ckz
CLAIM_LOCK_SUNSET=true
ESCROW_TICKET=
ESCROW_NETWORK=base-sepolia
MIGRATE=0004_v2_pool_participants (already applied)

# Scenario A — |E|=2 pool
A_BOUNTY_ID=
A_ISSUE=#
A_FACE_USDC=
A_WINNER_LOGIN=
A_POOL_LOGINS=enrique-lb, enrique-mp
A_WINNING_PR=#
A_POOL_PR_LB=#
A_POOL_PR_MP=#
A_SIGNAL_BY=enrique-lb
A_FEE_TX=                 # sepolia.basescan.org/tx/…
A_WINNER_TX=
A_POOL_TX_LB=
A_POOL_TX_MP=
A_AMOUNTS=                # fee / winner / each  (expect 2 / 83.30 / 7.35 at face 100)

# Scenario B — empty-pool regression (|E|=0, no pool transfers)
B_BOUNTY_ID=
B_ISSUE=#
B_FACE_USDC=
B_WINNER_LOGIN=enrique-lb
B_WINNING_PR=#
B_FEE_TX=
B_WINNER_TX=
B_POOL_TXES=none
B_AMOUNTS=                # fee / winner  (expect 2 / 98 at face 100)
B_NOTES=empty-pool regression: winner 100% post-fee; no POOL_PAYOUT
```
