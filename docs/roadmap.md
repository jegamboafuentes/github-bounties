# Public roadmap

High-level versions for **GitHub Bounties**. This is not Lightning Bounties / LB1.

The public `/roadmap` page reads the same items from [`apps/web/src/home/roadmap.ts`](../apps/web/src/home/roadmap.ts). Edit that constant (and this file) when a version actually ships. **Do not invent ship dates.**

Refreshed **as of 2026-09-24**. Status words only — the Funding wave date below is a recorded PROD ship date, not a forecast.

| Status | Meaning |
| --- | --- |
| `shipped` | On `main` and in the product (PROD unless noted) |
| `next` | Next. In planning; no public date |
| `then` | After next. Not scheduled |
| `later` | Later. No schedule |
| `parked` | Parked. Not scheduled |

## Shipped

### V1 — USDC escrow + merge is truth

Google sign-in, GitHub App, public board, 2% fee at settlement, winner = author of the merged pull request that closes funded issue `#N`.

### V2 — Parallel hunt + participation pool

V2-0…V2-5: 15% of **post-fee** to at most 10 eligible hunters, optional Working on this, roster + payout breakdown, exclusive 72h claim-lock sunset. Live DEV dogfood done. ADR 0003.

### Pool member self-claim

Manual pool Claim ([#47](https://github.com/jegamboafuentes/github-bounties/pull/47)) is on **PROD**. Winner Claim pays winner share + platform fee only and succeeds even if pool hunters have no Settings wallet. Each frozen pool participant Claims their own share later.

### Homepage stats, roadmap, differentiators

Live platform stats (`GET /api/stats`), this public roadmap, and vs-Lightning differentiators on the homepage.

### Bounty detail split charts (FE-2)

Pie / split visuals on bounty payout breakdown. Shipped on bounty pages.

### V3-0 — Issue body + bounty intelligence

**Shipped on PROD.** Full GitHub issue on the bounty detail page. Server-side Gemini card (repo about / stack / complexity S·M·L) as **AI estimates**, cached. Optional `GEMINI_API_KEY`; page degrades without it.

Related polish on PROD: board complexity/language badges + filters, Settings/Post connected-only copy, homepage motion/roadmap refresh. DEV header pill stays off on PROD.

### Funding wave

**LIVE on PROD 2026-09-24.**

1. Crowdfunding: USDC top-ups on already-funded bounties.
2. Fund any open public GitHub issue without installing the GitHub App. Claim runs through the public merge poller.
3. Funder avatars on the board cards and on the bounty page Funders list.

## Next

### V4 — API + MCP

**In planning.** AI can use the whole platform the way a human does. A public API documented with OpenAPI/Swagger, and an MCP server for Cursor, Claude, and ChatGPT.

## Then

### V5 — GitHub-native /bounty

Comment `/bounty <amount>` on an issue. USDC only. GitHub App required.

## Later

### V6+ — Agent economy

AI agents hunt and fund bounties over x402.

## Parked

### BTC payouts

Parked. No schedule.

### Hosted Coinbase checkout

Parked until settlement fee / net proceeds equal face ([ADR 0001](adr/0001-cdp-x402-wallets.md)). Fund remains x402 `exact` to `gb-escrow`.

## Explicit non-goals for this doc

- Fake “Q3 2026” or similar marketing dates
- PROD remount of the DEV Cloud Run service
- Treating FE-0 `/api/stats` or this homepage as a fee dashboard
