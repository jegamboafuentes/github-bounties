# Public roadmap

High-level versions for **GitHub Bounties**. This is not Lightning Bounties / LB1.

The public `/roadmap` page reads the same items from [`apps/web/src/home/roadmap.ts`](../apps/web/src/home/roadmap.ts). Edit that constant (and this file) when a version actually ships. **Do not invent ship dates.**

Refreshed **as of 2026-09-25**. Dates on shipped rows are recorded PROD ship dates, not forecasts. V5 and V6+ have no ship date.

| Status | Meaning |
| --- | --- |
| `shipped` | On `main` and LIVE on PROD unless noted |
| `next` | Next. Not built; no public date |
| `then` | After next. Not scheduled |
| `later` | Later. No schedule |
| `parked` | Parked. Not scheduled |

## Shipped

### V1 — USDC escrow + merge is truth

Google sign-in, GitHub App, public board, 2% fee at settlement, winner = author of the merged pull request that closes funded issue `#N`.

### V2 — Parallel hunt + participation pool

**LIVE on PROD 2026-09-19** ([githubbounties.xyz](https://githubbounties.xyz), Base mainnet USDC). V2-0…V2-5: 15% of **post-fee** to at most 10 eligible hunters, optional Working on this, roster + payout breakdown, exclusive 72h claim-lock sunset. ADR 0003.

### Pool member self-claim

**LIVE on PROD 2026-09-20.** Manual pool Claim ([#47](https://github.com/jegamboafuentes/github-bounties/pull/47)). Winner Claim pays winner share + platform fee only and succeeds even if pool hunters have no Settings wallet. Each frozen pool participant Claims their own share later.

### FE epic

**LIVE on PROD 2026-09-20.** Homepage stats (`GET /api/stats`), this public roadmap, and vs-Lightning differentiators. Bounty pages include the payout split charts.

### V3 wave

**LIVE on PROD 2026-09-21.** Full GitHub issue on the bounty detail page. Server-side Gemini card (repo about / stack / complexity S·M·L) as **AI estimates**, cached. Optional `GEMINI_API_KEY`; page degrades without it.

Related polish on PROD: board complexity/language badges + filters, Settings/Post connected-only copy, homepage motion/roadmap refresh. DEV header pill stays off on PROD.

### Funding wave

**LIVE on PROD 2026-09-24.**

1. Crowdfunding ([#61](https://github.com/jegamboafuentes/github-bounties/pull/61)): USDC top-ups on already-funded bounties.
2. Fund any public issue ([#64](https://github.com/jegamboafuentes/github-bounties/pull/64)) without installing the GitHub App. Claim runs through the public merge poller.
3. Funder avatars ([#65](https://github.com/jegamboafuentes/github-bounties/pull/65) to [#67](https://github.com/jegamboafuentes/github-bounties/pull/67)) on the board cards and on the bounty page Funders list.

### V4 — API + MCP

**DONE, LIVE on PROD 2026-09-25.** `/api/v1` (OpenAPI) + `/mcp`, version 4.4.0, 23 operations, 24 tools ([#76](https://github.com/jegamboafuentes/github-bounties/pull/76) [#79](https://github.com/jegamboafuentes/github-bounties/pull/79) [#80](https://github.com/jegamboafuentes/github-bounties/pull/80) [#81](https://github.com/jegamboafuentes/github-bounties/pull/81) [#78](https://github.com/jegamboafuentes/github-bounties/pull/78)). API money is OFF on PROD. On the site: [Developers](https://githubbounties.xyz/developers) (`/developers`).

## Next

### V5 — GitHub-native /bounty

GitHub-native bounty creation via a `/bounty` comment on a GitHub issue. Roadmap only. Nothing is built. No ship date.

## Then

### V6+ — Agent economy

The agent economy on x402. No ship date.

## Parked

### BTC payouts

Parked. No schedule.

### Hosted Coinbase checkout

Parked until settlement fee / net proceeds equal face ([ADR 0001](adr/0001-cdp-x402-wallets.md)). Fund remains x402 `exact` to `gb-escrow`.

## Explicit non-goals for this doc

- Fake “Q3 2026” or similar marketing dates
- PROD remount of the DEV Cloud Run service
- Treating FE-0 `/api/stats` or this homepage as a fee dashboard
- Building the V5 `/bounty` comment
