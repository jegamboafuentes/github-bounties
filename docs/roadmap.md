# Public roadmap

High-level upcoming versions for **GitHub Bounties**. This is not Lightning Bounties / LB1.

The homepage reads the same items from [`apps/web/src/home/roadmap.ts`](../apps/web/src/home/roadmap.ts). Edit that constant (and this file) when a version actually ships. **Do not invent ship dates.**

Status words:

| Status | Meaning |
| --- | --- |
| `shipped` | On `main` and in the product |
| `in_progress` | Work or dogfood is underway; no public date |
| `planned` | Intended; not scheduled |

## Shipped

### V1 — USDC escrow + merge is truth

Google sign-in, GitHub App, public board, 2% fee at settlement, winner = author of the merged pull request that closes funded issue `#N`.

### V2 — Parallel hunt + participation pool

V2-0…V2-4: 15% of **post-fee** to at most 10 eligible hunters, optional Working on this, roster + payout breakdown, exclusive 72h claim-lock sunset. ADR 0003.

### Pool member self-claim

Winner Claim pays winner share + platform fee only and succeeds even if pool hunters have no Settings wallet. Each frozen pool participant Claims their own share later. Hosted checkout stays disabled. DEV remount after merge; no PROD remount required.

## In progress

### V2-5 — DEV dogfood

Checklist / runbook is in [staging-e2e.md](staging-e2e.md). Live multi-hunter dogfood is pending Enrique. No public ship date.

### V3-0 — Issue body + bounty intelligence

Full GitHub issue on the bounty detail page. Server-side Gemini card (repo about / stack / complexity S·M·L) as **AI estimates**, cached. Optional `GEMINI_API_KEY`; page degrades without it. DEV remount only; PROD not wired.

## Planned (V3+)

No committed dates. Order may change.

### Bounty detail split charts (FE-2)

Pie / split visuals on bounty pages. Out of scope for the homepage slice.

### Hosted Coinbase checkout

Still **disabled** until settlement fee / net proceeds equal face (ADR 0001). DEV fund remains x402 `exact` to `gb-escrow`.

## Explicit non-goals for this doc

- Fake “Q3 2026” or similar marketing dates
- PROD remount of the DEV Cloud Run service
- Treating FE-0 `/api/stats` or this homepage as a fee dashboard
