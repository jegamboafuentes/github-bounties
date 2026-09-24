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

As of **2026-09-24**. No invented ship dates. `/roadmap`, About, and [docs/roadmap.md](docs/roadmap.md) use this list. Chain differs by environment; the versions do not.

| Environment | URL | Chain |
| --- | --- | --- |
| **PROD** | [githubbounties.xyz](https://githubbounties.xyz) | Real USDC on **Base mainnet**. |
| **DEV** | [dev.githubbounties.xyz](https://dev.githubbounties.xyz) | Test USDC on **Base Sepolia**. |

### Shipped

- **V1** — USDC escrow + merge is truth. Google sign-in, GitHub App, board, 2% fee, winner = merged PR author that closes funded #N.
- **V2** — Parallel hunt + participation pool. V2-0…V2-5: 15% of post-fee to up to 10 hunters, signals, roster, claim-lock sunset. Live DEV dogfood done.
- **V2.6** — Pool member self-claim. Manual pool Claim (#47) on PROD. Winner Claim pays winner + fee only. Each frozen pool hunter Claims their own share when they have a wallet.
- **FE** — Homepage stats, roadmap, differentiators. Live platform stats, public roadmap, and vs-Lightning differentiators on the homepage. Same aggregates as GET /api/stats.
- **FE-2** — Bounty detail split charts. Pie / split visuals on bounty payout breakdown. Shipped on bounty pages.
- **V3-0** — Issue body + bounty intelligence. Shipped on PROD. Full GitHub issue + Gemini about/stack/complexity (AI estimates, cached). Related polish: board badges/filters, Settings/Post connected-only, homepage motion/roadmap refresh.
- **Funding wave** — LIVE on PROD 2026-09-24. Crowdfunding: USDC top-ups on already-funded bounties. Fund any open public GitHub issue without installing the GitHub App, with Claim running through the public merge poller. Funder avatars on the board cards and on the bounty page Funders list.

### Next

- **V4 — API + MCP.** In planning. AI can use the whole platform the way a human does. Public API documented with OpenAPI/Swagger, and an MCP server for Cursor, Claude, and ChatGPT.

### Then

- **V5 — GitHub-native /bounty.** Comment `/bounty <amount>` on an issue. USDC only. GitHub App required.

### Later

- **V6+ — Agent economy.** AI agents hunt and fund bounties over x402.

### Parked

- **BTC payouts.** Parked. No schedule.
- **Hosted Coinbase checkout.** Parked until settlement fee / net proceeds equal face (ADR 0001). x402 exact remains the fund rail.

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
| Issue body + Gemini intelligence | [docs/bounty-intelligence.md](docs/bounty-intelligence.md) |
| Sign-in identity + DEV transactional email (welcome and domain events, not remounted) | [docs/email.md](docs/email.md) |
| Public stats (`GET /api/stats`) | [docs/stats.md](docs/stats.md) |
| Read-only public API + MCP (V4-1) | [docs/api.md](docs/api.md) |
| Google sign-in | [docs/google-signin.md](docs/google-signin.md) |
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
- Hosted Coinbase checkout and BTC payouts are parked (see [docs/roadmap.md](docs/roadmap.md)).

## Sandbox / historical spikes

Early V0 tickets proved custody and webhooks **before** product UI. They are not the live status.

```bash
node scripts/money-path-dry-run.mjs
```

Without `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET` the script **exits 2** and lists the missing names. It never broadcasts mainnet USDC. Optional Base Sepolia live fund→release (test USDC only) needs those secrets **and** `CDP_DRY_RUN_LIVE=1`. Notes: [docs/spikes/v0-a-sandbox-dry-run.md](docs/spikes/v0-a-sandbox-dry-run.md).

Webhook HMAC / eligibility fixtures live under repo-root `src/` and stay green via `npm test`. Live App delivery is the product path in `apps/web` ([docs/github-app.md](docs/github-app.md)).
