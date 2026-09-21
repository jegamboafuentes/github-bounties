# Public roadmap

High-level versions for **GitHub Bounties**. This is not Lightning Bounties / LB1.

The homepage reads the same items from [`apps/web/src/home/roadmap.ts`](../apps/web/src/home/roadmap.ts). Edit that constant (and this file) when a version actually ships. **Do not invent ship dates.**

Status words:

| Status | Meaning |
| --- | --- |
| `shipped` | On `main` and live (production unless the item says DEV) |
| `in_progress` | Underway; no public date |
| `planned` | Intended; not scheduled |

## Shipped

### V1 — USDC escrow + merge is truth

Google sign-in, GitHub App, public board. 2% fee at settlement. Winner is the author of the merged pull request that closes funded issue `#N`. Live on production.

### V2 — Parallel hunt + participation pool

15% of **post-fee** split among up to 10 hunters. Optional Working on this, roster, and payout breakdown. Exclusive claim-lock retired. Live on production. ADR 0003.

### Pool member self-claim

Winner Claim pays winner share + platform fee only. Each pool hunter Claims their own share when they have a wallet.

### Homepage + payout charts

Live platform stats, public roadmap, and split pies on bounty pages.

### V3-0 — Issue body + bounty intelligence

Full GitHub issue on the bounty page. Gemini estimates about, stack, and complexity (AI estimates, cached). Board badges and filters. Live on DEV. Production is next.

## In progress

### Intelligence on production

Bring issue body, bounty intelligence, and repos-with-bounties to production. No public date.

## Planned

No committed dates. Order may change.

### Hosted Coinbase checkout

Still **off** until settlement fee and net proceeds match face (ADR 0001). x402 `exact` stays the fund rail.

## Explicit non-goals for this doc

- Fake “Q3 2026” or similar marketing dates
- Remounting the DEV Cloud Run service onto the apex
- Treating homepage stats as a fee dashboard
- Internal dogfood checklists as public phases
