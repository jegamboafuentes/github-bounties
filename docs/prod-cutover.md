# Production cutover — `githubbounties.xyz`

Enrique greenlit GO PROD on **2026-09-19**. Target is a **new** Cloud Run
service on GCP project `experiment-jegf` / `42206083192`, region
`us-central1`, apex **`https://githubbounties.xyz`**, Base **mainnet** real
USDC.

This is **not** a remount of DEV (`github-bounties-web` /
`https://dev.githubbounties.xyz`). Do not point the DEV service, DEV Cloud SQL,
DEV secrets, or the staging GitHub / Google clients at the apex.

**This file does not create GCP resources.** Eng ships the client fund-chain
gate. Ops / Enrique apply the checklist below **after merge, before the first
PROD deploy**.

Staging remains [`staging-deploy.md`](staging-deploy.md). Closed-beta Sepolia
dogfood stays [`staging-e2e.md`](staging-e2e.md). Hosted Coinbase checkout stays
**OFF**.

---

## Target lock

| Item | PROD value | Do not use |
| --- | --- | --- |
| GCP project | `experiment-jegf` | A different project, or remounting DEV |
| Cloud Run service | `github-bounties-web-prod` (suggested) | `github-bounties-web` (DEV) |
| Image | same Artifact Registry repo, new tag/revision | DEV revision in-place |
| Custom domain | `https://githubbounties.xyz` | `dev.githubbounties.xyz` |
| Cloud SQL | **new** instance, e.g. `github-bounties-prod` | `github-bounties-staging` |
| Labels | `product=github-bounties,env=prod` | `env=staging` |
| Rail | `CDP_NETWORK=base` + `CDP_ALLOW_MAINNET=1` | Sepolia default; mainnet without the allow flag |
| Asset | native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Sepolia test USDC |
| Hosted checkout | disabled | Do not enable |

Suggested `connectionName`:
`experiment-jegf:us-central1:github-bounties-prod`.

`deploy-web.sh --service github-bounties-web-prod` already accepts a service
name. SQL instance, labels, and secret ids are still the staging defaults in
`infra/gcloud/config.sh` — **do not** run that helper against PROD until Ops
overrides `SQL_CONNECTION` / labels / `--set-secrets` for the prod map. Prefer
an explicit `gcloud run deploy github-bounties-web-prod …` the first time.

---

## After merge, before first PROD deploy

### 1. Enrique — product / money go-live

- [ ] Confirm this cutover is still a go (apex + real USDC).
- [ ] Fund **mainnet** CDP server wallets `gb-escrow` and `gb-fee` with enough
      **USDC** (face + 2% fee outflow) and **ETH** (gas) on Base. These are not
      the Sepolia dry-run balances.
- [ ] Confirm CDP project / keys used on PROD are allowed to transfer native
      USDC on `base`. Prefer keys that are not the DEV Sepolia-only set if Ops
      can issue a separate pair.
- [ ] Reown / WalletConnect Cloud: allow origin **`https://githubbounties.xyz`**
      (and `http://localhost:3000` if you still dogfood locally). Do not rely
      on the DEV-only allowlist (`https://dev.githubbounties.xyz`).
- [ ] Create a **separate production GitHub App** (name e.g. `GitHub Bounties`)
      with webhook / setup / callback on the apex. See [github-app.md](github-app.md).
      Do not retarget the staging App at prod.
- [ ] Create a **separate Google OAuth Web client** (or a dedicated prod
      client) with JS origin `https://githubbounties.xyz` and redirect
      `https://githubbounties.xyz/api/auth/callback/google`. See
      [google-signin.md](google-signin.md).
- [ ] Map the Cloud Run custom domain `githubbounties.xyz` (DNS + Cloud Run
      domain mapping). Do not invent a `*.run.app` host in git; read it after
      the service exists if you need it for a temporary health probe.
- [ ] Do **not** enable hosted checkout.

### 2. Ops — new service + separate data plane

- [ ] Create Cloud SQL instance `github-bounties-prod` (Postgres 16,
      `requireSsl=true`, DB `github_bounties`, user `gb_app`). **New**
      password. Never reuse the staging `DATABASE_URL`.
- [ ] Create **separate Secret Manager ids** for PROD. Staging names
      (`DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_*`, `GITHUB_*`, `CDP_*`) already
      hold DEV values on this project. Binding those same ids to the prod
      service would share the DEV database and OAuth/App/CDP keys.

Suggested SM ids (bind to the env names the app already reads):

| Env var | Suggested SM id | First prod deploy |
| --- | --- | --- |
| `DATABASE_URL` | `PROD_DATABASE_URL` | yes — unix-socket form for the **prod** instance |
| `AUTH_SECRET` | `PROD_AUTH_SECRET` | yes — new Auth.js secret; do not copy DEV |
| `GOOGLE_OAUTH_CLIENT_ID` | `PROD_GOOGLE_OAUTH_CLIENT_ID` | yes — prod Web client |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `PROD_GOOGLE_OAUTH_CLIENT_SECRET` | yes |
| `GITHUB_APP_ID` | `PROD_GITHUB_APP_ID` | yes — prod App |
| `GITHUB_APP_SLUG` | `PROD_GITHUB_APP_SLUG` | yes |
| `GITHUB_WEBHOOK_SECRET` | `PROD_GITHUB_WEBHOOK_SECRET` | yes |
| `GITHUB_APP_PRIVATE_KEY` | `PROD_GITHUB_APP_PRIVATE_KEY` | yes |
| `GITHUB_APP_CLIENT_ID` | `PROD_GITHUB_APP_CLIENT_ID` | yes |
| `GITHUB_APP_CLIENT_SECRET` | `PROD_GITHUB_APP_CLIENT_SECRET` | yes |
| `CDP_API_KEY_ID` | `PROD_CDP_API_KEY_ID` | yes — mainnet-capable keys |
| `CDP_API_KEY_SECRET` | `PROD_CDP_API_KEY_SECRET` | yes |
| `CDP_WALLET_SECRET` | `PROD_CDP_WALLET_SECRET` | yes |
| `CDP_PROJECT_ID` | `PROD_CDP_PROJECT_ID` | yes |
| `CDP_CLIENT_API_KEY` | `PROD_CDP_CLIENT_API_KEY` | yes |
| `AUTH_URL` | `PROD_AUTH_URL` | **after** apex is live; value `https://githubbounties.xyz` |
| `CDP_WEBHOOK_SECRET` | — | skip (same as staging: do not bind empty) |
| `CRON_SECRET` | optional later | skip on first deploy |
| `GEMINI_API_KEY` | — | **skip** on first PROD deploy. V3-0 intelligence is DEV-only for now. Do not bind the DEV `GEMINI_API_KEY` secret onto `github-bounties-web-prod`. |
| `RESEND_API_KEY` | — | **skip**. Transactional email is DEV-only. Do not bind the DEV secret onto `github-bounties-web-prod`. Do not set `RESEND_FROM` on PROD. Dispatch also refuses this service. |

`--set-secrets=DATABASE_URL=PROD_DATABASE_URL:latest,…` (env = SM id). Values
stay out of git / chat. Add versions from stdin:

```bash
gcloud secrets versions add PROD_AUTH_URL --data-file=- --project=experiment-jegf
# paste https://githubbounties.xyz only, newline, Ctrl-D
```

- [ ] Migrate the **prod** database (Auth Proxy or Cloud Run Job against
      `github-bounties-prod`). Do not run `db:seed` on prod.
- [ ] Runtime SA `github-bounties-runtime@…` already has
      `cloudsql.client` + `secretmanager.secretAccessor` on this project.
      Grant Cloud SQL client on the **new** instance if the existing binding
      is instance-scoped.
- [ ] Deploy `github-bounties-web-prod` with the plain env below. Do not
      update `github-bounties-web`.

### 3. Plain env (not Secret Manager)

| Env | PROD | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `AUTH_TRUST_HOST` | `true` | First revision, same as staging |
| `AUTH_URL` | `https://githubbounties.xyz` | SM after apex exists |
| `PUBLIC_BASE_URL` | `https://githubbounties.xyz` | GitHub URL helpers + WalletConnect metadata origin |
| `CDP_NETWORK` | `base` | Also accepts `base-mainnet` / `eip155:8453` |
| `CDP_ALLOW_MAINNET` | `1` | Required. Client + rail stay Sepolia if this is unset |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Reown project id | Public; not SM. Apex must be allowlisted |
| `PORT` | `8080` | Cloud Run |

`deploy-web.sh` / `web_plain_env_pairs` pass `CDP_NETWORK` (default
`base-sepolia`) and, **only if set**, `CDP_ALLOW_MAINNET`. For PROD:

```bash
export CDP_NETWORK=base
export CDP_ALLOW_MAINNET=1
export PUBLIC_BASE_URL=https://githubbounties.xyz
export NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID='<reown-project-id>'
```

Without `CDP_ALLOW_MAINNET=1`, WalletConnect / Pay stay on Base Sepolia and
`eip155:8453` is `mainnet_refused` — even if `CDP_NETWORK=base`.

### 4. Health smoke (first revision)

Expect `escrow.hosted_checkout.enabled === false`. With prod CDP secrets +
the allow flag:

```json
{
  "ok": true,
  "service": "github-bounties-web",
  "escrow": {
    "rail": "cdp",
    "network": "base",
    "missing": [],
    "hosted_checkout": { "enabled": false },
    "mainnet_refused": false
  }
}
```

`service` in JSON is the product name (`github-bounties-web`), not the Cloud
Run service id. Confirm:

- [ ] HTTP 200 on `GET /api/health`
- [ ] `escrow.network` is `base` (or the alias you set)
- [ ] `escrow.mainnet_refused` is `false`
- [ ] `escrow.hosted_checkout.enabled` is `false`
- [ ] WalletConnect: `escrow.walletconnect.configured` is `true` after the
      Reown id is set; metadata origin is the apex (not `dev.githubbounties.xyz`)
- [ ] Google sign-in on the apex
- [ ] GitHub App webhook deliveries hit `{PUBLIC_BASE_URL}/webhooks/github`
- [ ] One tiny mainnet fund (Enrique): Pay face USDC on Base → Lock. Not
      Sepolia test USDC.

---

## What Eng changed (this cutover PR)

Client fund / WalletConnect was Sepolia-hardcoded. It now follows the rail:

- `CDP_NETWORK` in `{base, base-mainnet, eip155:8453}` **and**
  `CDP_ALLOW_MAINNET` truthy (`1` / `true` / `yes`) → wagmi `base`, native
  USDC, Pay path allowed, live x402 seller registers `eip155:8453`.
- Otherwise → Base Sepolia (DEV default). Mainnet challenges still
  `mainnet_refused`.
- WalletConnect metadata `url` / icons come from `PUBLIC_BASE_URL` or
  `AUTH_URL`, then `http://localhost:3000`.

The server layout reads those env vars at **runtime** and passes the fund
chain into the browser (same pattern as `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`).
Do not expect a `NEXT_PUBLIC_CDP_*` rebuild.

---

## Out of scope

- Creating the Cloud Run service, Cloud SQL instance, secrets, DNS, or OAuth
  / GitHub App in this PR.
- Hosted checkout.
- Soft V2 copy nits on the marketing home card.
- Remounting or retargeting DEV.
