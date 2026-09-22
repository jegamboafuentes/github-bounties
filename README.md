<p align="center">
  <a href="https://githubbounties.xyz">
    <img src="apps/web/public/brand/logo-1.png" alt="GitHub Bounties" width="420" />
  </a>
</p>

<p align="center">
  <a href="https://githubbounties.xyz"><strong>PROD</strong></a>
  · Base mainnet USDC<br />
  <a href="https://dev.githubbounties.xyz"><strong>DEV</strong></a>
  · Base Sepolia
</p>

# GitHub Bounties

USDC bounties on GitHub issues. Sign in with Google, connect the GitHub App, post a bounty on an issue, and pay the author of the merged pull request that closes funded `#N`. Hunters work in parallel; **merge is truth**.

This is **not** Lightning Bounties, LB1, or “Lightning Bounties 2”. Older product docs may still live at [docs.lightningbounties.com](https://docs.lightningbounties.com/docs); the shipped product is **GitHub Bounties**.

## Status now

As of **2026-09-21**. No invented ship dates. V3-0 is **DEV only** — do not treat it as live on PROD.

| Environment | URL | What’s live |
| --- | --- | --- |
| **PROD** | [githubbounties.xyz](https://githubbounties.xyz) | V1 core + V2 pool + FE epic. Real USDC on **Base mainnet**. |
| **DEV** | [dev.githubbounties.xyz](https://dev.githubbounties.xyz) | Everything on PROD **plus V3-0**. Test USDC on **Base Sepolia**. |

### On PROD

- **V1 core** — Google sign-in, GitHub App, public board, post bounty, 2% fee at settlement
- **Money** — CDP escrow (`gb-escrow`) + x402 / WalletConnect fund on Base mainnet
- **V2 multi-hunter pool** ([ADR 0003](docs/adr/0003-v2-multi-hunter-pool.md)) — 15% of **post-fee** to up to 10 eligible hunters; exclusive 72h claim-lock is **retired**; live DEV dogfood done
- **Manual pool Claim** ([#47](https://github.com/jegamboafuentes/github-bounties/pull/47)) — winner Claim settles winner + fee only (works without pool wallets); each pool member Claims their own share later
- **FE** — homepage Anime.js + live stats + differentiators + public roadmap; bounty payout pie charts; public `GET /api/stats` (`schemaVersion` **1**)

### On DEV only (not PROD)

- **V3-0** ([#48](https://github.com/jegamboafuentes/github-bounties/pull/48)) — full GitHub issue body on the bounty page; Gemini intelligence card (repo about / stack / complexity S·M·L) via server-only `GEMINI_API_KEY`
- Stats: `repos.withBounties` replaces App-install “repos connected” (`schemaVersion` **2** on `main`)
- Settings / Post show GitHub **connected vs not** (no repo dump)
- Board complexity/language badges + filters; DEV header pill

### Not shipped / deferred

- Hosted Coinbase checkout: **planned / deferred** (ADR 0001; parked later)
- V4 public API + MCP; V5 agent economy — planned, no dates
- BTC / sats payouts: **deferred**
- **V3 is not on PROD**
- Transactional email foundation (welcome outbox) is in the repo for a later DEV remount. It does not send until Ops mounts optional `RESEND_API_KEY` and sets `RESEND_FROM`. Not on PROD.

Public roadmap copy: [docs/roadmap.md](docs/roadmap.md).

## Money path

The product money path **is wired**. PROD moves real USDC. Early V0-A “no prod spend / not wired into UI” language is historical — see [Sandbox](#sandbox--historical-spikes).

| Item | Lock |
| --- | --- |
| Rail | CDP server wallets + x402 USDC on Base (mainnet on PROD, Sepolia on DEV) |
| Escrow | Platform wallet `gb-escrow` holds face **F** until settle or refund |
| Fee | **2% of face** at **settlement** only: `fee = floor(F × 0.02)` → `gb-fee` |
| V2 pool | 15% of **post-fee** (not of face), max 10 hunters; empty pool → winner gets 100% of post-fee (98% of F) |
| Claim-lock | Exclusive 72h lock is **retired** and **never moved money**. Optional **Working on this** is a non-exclusive signal. |
| Fund UX | x402 `exact` to `gb-escrow` + WalletConnect / Pay face. Paste-hash stays under Advanced. Hosted checkout is off. |
| Refund / cancel | Full **F** to the funder. No fee, no pool. |

Decisions, sequences, and failure modes:

- [ADR 0001 — CDP wallets + x402 USDC escrow](docs/adr/0001-cdp-x402-wallets.md) (Accepted)
- [ADR 0002 — DEV fund Lock via x402 `exact`](docs/adr/0002-x402-exact-dev-fund.md)
- [ADR 0003 — V2 multi-hunter pool](docs/adr/0003-v2-multi-hunter-pool.md) (Accepted; V2-0…V2-4 + manual pool Claim shipped)
- [ADR index](docs/adr/README.md)

## Feature map

| Area | Docs |
| --- | --- |
| Bounty post, board, parallel hunt | [docs/bounties.md](docs/bounties.md) |
| Escrow, 2% fee, x402 Lock | [docs/escrow.md](docs/escrow.md) |
| Winner + pool Claim | [docs/claims.md](docs/claims.md) |
| Issue body + Gemini intelligence (DEV) | [docs/bounty-intelligence.md](docs/bounty-intelligence.md) |
| Public stats (`GET /api/stats`) | [docs/stats.md](docs/stats.md) |
| Google sign-in | [docs/google-signin.md](docs/google-signin.md) |
| Transactional email (DEV foundation) | [docs/transactional-email.md](docs/transactional-email.md) |
| GitHub App + webhooks | [docs/github-app.md](docs/github-app.md), [docs/webhooks.md](docs/webhooks.md) |
| Schema | [docs/v1-schema.md](docs/v1-schema.md) |
| DEV deploy / E2E | [docs/staging-deploy.md](docs/staging-deploy.md), [docs/staging-e2e.md](docs/staging-e2e.md) |
| PROD cutover (apex, mainnet, separate stack) | [docs/prod-cutover.md](docs/prod-cutover.md) |

Product app: [`apps/web`](apps/web) (Next.js App Router, Drizzle, Cloud Run `standalone`).

## Local development

```bash
docker compose up -d postgres
cd apps/web
cp .env.example .env   # local DATABASE_URL only — never commit .env
npm install
npm run db:migrate
npm run db:seed
npm run test:unit
npm run test:db
npm run dev            # http://localhost:3000
```

Details: [apps/web/README.md](apps/web/README.md). Cloud SQL migrate is Ops-only: [docs/staging-deploy.md](docs/staging-deploy.md).

Root webhook spike (still in CI):

```bash
npm install
npm test
cp .env.example .env   # set GITHUB_WEBHOOK_SECRET locally
GITHUB_WEBHOOK_SECRET='test-secret' npm run replay -- fixtures/pull-request-merged-fixes.json --twice
```

No secrets belong in git. App private keys (`*.pem`) are gitignored. Empty placeholders only in `.env.example`.

## Infra notes

- GCP project is still **`experiment-jegf`** (`42206083192`). DEV and PROD are **separate** Cloud Run services, Cloud SQL instances, and Secret Manager stacks. Do not remount DEV onto the apex.
- Suggested names: DEV `github-bounties-web` / `github-bounties-staging`; PROD `github-bounties-web-prod` / `github-bounties-prod`. See [docs/prod-cutover.md](docs/prod-cutover.md).
- Hosted Coinbase checkout stays disabled. BTC/sats payouts are deferred.

## Sandbox / historical spikes

Early V0 tickets proved custody and webhooks **before** product UI. They are not the live status.

```bash
node scripts/money-path-dry-run.mjs
```

Without `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET` the script **exits 2** and lists the missing names. It never broadcasts mainnet USDC. Optional Base Sepolia live fund→release (test USDC only) needs those secrets **and** `CDP_DRY_RUN_LIVE=1`. Notes: [docs/spikes/v0-a-sandbox-dry-run.md](docs/spikes/v0-a-sandbox-dry-run.md).

Webhook HMAC / eligibility fixtures live under repo-root `src/` and stay green via `npm test`. Live App delivery is the product path in `apps/web` ([docs/github-app.md](docs/github-app.md)).
