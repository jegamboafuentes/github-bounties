# Claim payout (V1-6 / V2-4)

Official name: **GitHub Bounties**. After a merged PR closes funded issue `#N`, V1-3 writes `claims.status=eligible`. The **eligible winner** (merged PR author tied to that claim) claims **winner share + 2% fee** to a bring-your-own Base address. Frozen pool members each Claim their own equal share later. Winner Claim must succeed even if pool hunters have no Settings wallet.

This ticket does **not** reimplement money rails. It calls V2-3 [`settleEscrow`](../apps/web/src/escrow/service.ts). Mock rail is OK until CDP Secret Manager is filled. Hosted checkout stays **disabled**.

This is not Lightning Bounties / LB1. No custodial wallets. No dispute window. No agent marketplace.

## Who can claim

| Actor | Result |
| --- | --- |
| Eligible hunter (`claims.hunter_user_id` = session user, status `eligible` or already `paid`) | Winner share + fee only (idempotent if already paid). Does **not** pay pool legs. |
| Frozen pool participant (`pool_participants.role=pool`) | Their frozen `POOL_PAYOUT` only. Wallet required at *their* Claim. **403** `pool_not_ready` until winner payout confirms. |
| Poster | **403** `not_hunter` / `not_pool_member` (can still see roster + breakdown; poster settle API remains winner+fee) |
| Any other signed-in user | **403** `not_hunter` / `not_pool_member` — cannot claim winner or pool payout they do not own |
| Anonymous | **401** — can still see roster + breakdown |
| No eligible/paid claim | **403** `not_eligible` |
| Merge recorded but PR author has no `github_links` row | **403** `hunter_not_linked` — Connect GitHub as that login. Working on this is not paid. |

The hunter is the GitHub account that authored the merged PR. V1-3 linked that login to `users` via `github_links`. Exclusive claim-lock is retired; a **Working on this** signal is **not** the winner.

Pool members are not `claims` rows. They Claim `allocation_ledger` `POOL_PAYOUT` legs to `users.wallet_address` / `pool_participants.payout_address`. Missing wallet at winner Claim is expected (`settled_partial` / **Winner paid — pool pending**). The share is not redistributed. Double-Claim reuses the V1-5 / V2-3 idempotency key per leg.

## Amounts

ADR 0003 / V2-3. Fee at settlement only:

```
fee_atomic    = floor(face_atomic * 200 / 10_000)   // fee_bps = 200
post_fee      = face − fee
pool_atomic   = |E| = 0 ? 0 : floor(post_fee × 1500 / 10_000)  // 15% of 98%
winner        = post_fee − paid pool (includes dust)
```

UI shows **face / 2% fee / winner ≈83.3% / pool ≈14.7%** (or **100% of post-fee** when `E` is empty — V1 98%). Winner Claim success: `claims.status=paid`. Empty pool → `bounties.status=settled` (**Completed (paid)**). Pool pending → `settled_partial` (**Winner paid — pool pending**). Already-claimed shares show **Paid**. Each confirmed tx hash is listed on the bounty page.

## BYO Base address

Format: `0x` + 40 hex characters. ENS and the zero address are rejected. Saved on:

- `users.wallet_address` (Settings and on successful winner claim)
- `claims.payout_address` (the address used for the winner payout)

Pool members set the same address on Settings. No custodial wallet is created.

## Surfaces

| URL | Auth | Role |
| --- | --- | --- |
| `/bounties/[id]` | public read; Google for claim | Roster + breakdown for everyone. Winner Claim CTA vs per-member pool Claim CTA |
| `/settings` | Google | Save default BYO Base address. Shows connected GitHub login; **Disconnect** unlinks `github_links` (confirm) so a different login can Connect. |
| `/board` | public | Eligible / completed (paid) / winner paid — pool pending + Working on this (not exclusive lock) |
| `POST /api/bounties/:id/claim` | Google | Winner path, or `{ kind: "pool", participantId? }` for a pool share |

`POST /api/bounties/:id/settle` remains the settle API (poster or hunter). Product claim UX goes through `/claim`.

If Claim hits a rail error **before** a hunter payout hash (e.g. CDP `rail_failed` / insufficient ETH gas on `gb-escrow`), the bounty stays **`settling`** with `escrows.fail_code` / `fail_reason`. Detail + Claim UI show the same Lock-style fail banner. Claim stays eligible and retryable. Ops must still faucet ETH — this is observability, not a gas fix.

## Mock vs CDP

| Mode | When | What the hunter sees |
| --- | --- | --- |
| **mock** | any of `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` missing | `mock:0x…` hashes + a notice listing the **exact** missing env names |
| **cdp** | all three set and network is safe | Live USDC on Base Sepolia (or mainnet only with `CDP_ALLOW_MAINNET=1`) |

Mainnet is refused by default. Secrets never belong in git.

## Manual test (local / staging)

1. `docker compose up -d postgres` then `cd apps/web && npm run db:migrate && npm run db:seed && npm run dev`.
2. Board: seed `#44` shows **Completed (paid)** and `mock:0xseedpayout44`. Seed `#42` shows **Payout eligible**. Seed `#50` shows a 2-hunter roster (alice, bob) and Working on this.
3. Open `/bounties/<id>` for `#42` — empty-pool style winner share 98 (100% of post-fee). Sign-in CTA unless you are the hunter. Open `#50` — face 100 / fee 2 / winner 83.30 / pool 14.70 / each 7.35.
4. As the **linked hunter** (Google session whose `github_links` matches the merged PR author):
   - Settings → save a Base address, **or** enter one on the bounty form.
   - Submit **Claim winner share … USDC**. Winner + fee pay; pool wallets are not required. Empty pool → completed (paid). Otherwise **Winner paid — pool pending**.
5. As a frozen pool hunter: **Claim pool share … USDC** after the winner has claimed. Wallet required now. Double-submit does not double-pay.
6. As poster or any other user: submit (or `POST /api/bounties/:id/claim`) → clear `not_hunter` / `not_pool_member`. Roster + breakdown stay visible.
7. Without CDP secrets, expect the mock-rail notice. With secrets, hashes are live Sepolia txs (see [escrow.md](escrow.md)).

## Out of scope

- Custodial wallets
- Dispute window
- Agent marketplace
- Enabling hosted checkout
