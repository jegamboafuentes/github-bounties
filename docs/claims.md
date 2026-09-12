# Claim payout (V1-6)

Official name: **GitHub Bounties**. After a merged PR closes funded issue `#N`, V1-3 writes `claims.status=eligible`. The **eligible hunter** (merged PR author tied to that claim) claims net-of-fee USDC to a bring-your-own Base address.

This ticket does **not** reimplement money rails. It calls V1-5 [`settleEscrow`](../apps/web/src/escrow/service.ts). Mock rail is OK until CDP Secret Manager is filled. Hosted checkout stays **disabled**.

This is not Lightning Bounties / LB1. No custodial wallets. No dispute window. No agent marketplace.

## Who can claim

| Actor | Result |
| --- | --- |
| Eligible hunter (`claims.hunter_user_id` = session user, status `eligible` or already `paid`) | Payout (idempotent if already paid) |
| Poster | **403** `not_hunter` |
| Any other signed-in user | **403** `not_hunter` |
| Anonymous | **401** |
| No eligible/paid claim | **403** `not_eligible` |
| Merge recorded but PR author has no `github_links` row | **403** `hunter_not_linked` — Connect GitHub as that login. Claim-lock holder is not paid. |

The hunter is the GitHub account that authored the merged PR. V1-3 linked that login to `users` via `github_links`. The exclusive claim-lock holder is **not** the winner.

## Amounts

Same V1-5 split. Fee at settlement only:

```
fee_atomic    = floor(face_atomic * 200 / 10_000)   // fee_bps = 200
hunter_atomic = face_atomic - fee_atomic
```

UI shows **face / 2% fee / net / payout tx**. After success: `claims.status=paid`, `bounties.status=settled` (board label **Completed (paid)**).

## BYO Base address

Format: `0x` + 40 hex characters. ENS and the zero address are rejected. Saved on:

- `users.wallet_address` (Settings and on successful claim)
- `claims.payout_address` (the address used for this payout)

No custodial wallet is created.

## Surfaces

| URL | Auth | Role |
| --- | --- | --- |
| `/bounties/[id]` | public read; Google for claim | Eligible hunter enters a Base address and claims |
| `/settings` | Google | Save default BYO Base address |
| `/board` | public | Eligible / completed (paid) captions + tx when paid |
| `POST /api/bounties/:id/claim` | Google | Same hunter-only path as the form |

`POST /api/bounties/:id/settle` remains the V1-5 minimal settle API (poster or hunter). Product claim UX goes through `/claim`.

If Claim hits a rail error **before** a hunter payout hash (e.g. CDP `rail_failed` / insufficient ETH gas on `gb-escrow`), the bounty stays **`settling`** with `escrows.fail_code` / `fail_reason`. Detail + Claim UI show the same Lock-style fail banner. Claim stays eligible and retryable. Ops must still faucet ETH — this is observability, not a gas fix.

## Mock vs CDP

| Mode | When | What the hunter sees |
| --- | --- | --- |
| **mock** | any of `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` missing | `mock:0x…` hashes + a notice listing the **exact** missing env names |
| **cdp** | all three set and network is safe | Live USDC on Base Sepolia (or mainnet only with `CDP_ALLOW_MAINNET=1`) |

Mainnet is refused by default. Secrets never belong in git.

## Manual test (local / staging)

1. `docker compose up -d postgres` then `cd apps/web && npm run db:migrate && npm run db:seed && npm run dev`.
2. Board: seed `#44` shows **Completed (paid)** and `mock:0xseedpayout44`. Seed `#42` shows **Payout eligible**.
3. Open `/bounties/<id>` for `#42` — face 100 / fee 2 / net 98. Sign-in CTA unless you are the hunter.
4. As the **linked hunter** (Google session whose `github_links` matches the merged PR author):
   - Settings → save a Base address, **or** enter one on the bounty form.
   - Submit **Claim … USDC**. Bounty becomes completed (paid); claim row stores net + tx.
5. As poster or any other user: submit (or `POST /api/bounties/:id/claim`) → clear `not_hunter` error. Bounty stays unpaid.
6. Without CDP secrets, expect the mock-rail notice. With secrets, hashes are live Sepolia txs (see [escrow.md](escrow.md)).

## Out of scope

- Custodial wallets
- Dispute window
- Agent marketplace
- Enabling hosted checkout
