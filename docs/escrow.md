# Escrow + 2% fee (V1-5)

Official name: **GitHub Bounties**. Money path follows [ADR 0001](adr/0001-cdp-x402-wallets.md) (Accepted).

`gb-escrow` (CDP server wallet) holds face **F**. On merge/settle, hunter gets `F − floor(F × 0.02)` and `gb-fee` gets the 2%. On poster cancel or bounty `expires_at` (unmerged), the funder gets **full F**. Claim-lock is still coordination only and **does not** refund.

This is not Lightning Bounties / LB1. V2 participation pool is out of scope. Hosted Coinbase Business checkout stays **disabled**.

## Status mapping

Ticket language → `escrows.status` (schema unchanged):

| Ticket | DB |
| --- | --- |
| pending | `pending` |
| locked | `funded` |
| released | `settled` |
| refunded | `refunded` |

`pending → funded → settling → settled | settled_partial`, or `funded → refunding → refunded`.

## Fee (settlement only)

```
fee_atomic    = floor(face_atomic * 200 / 10_000)   // fee_bps = 200
hunter_atomic = face_atomic - fee_atomic
```

Fee is computed from **face**, never from “amount received after Coinbase fees”. No `FEE_OUT` on refund. `fee_ledger` is written when both settle legs confirm (or fee is 0).

## Rails

| Mode | When | What happens |
| --- | --- | --- |
| **mock** | any of `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` missing | Lock/settle/refund persist `mock:0x…` hashes and list the **exact** missing env names. Not a silent on-chain lock. |
| **cdp** | all three secrets present and network is safe | `getOrCreateAccount` for `gb-escrow` / `gb-fee`. Transfers use the same idempotency key we persist. |
| **refused** | `CDP_NETWORK=base` (or other mainnet alias) without `CDP_ALLOW_MAINNET=1` | No transfers. Default network is `base-sepolia`. |

Hosted checkout create/capture is **not implemented**. See [open Q](#hosted-checkout-disabled).

## Secrets (names only)

GCP project **`experiment-jegf`** / `42206083192`. Secret Manager IDs already listed in [`.env.example`](../.env.example):

| Env / SM id | Required |
| --- | --- |
| `CDP_API_KEY_ID` | yes for live |
| `CDP_API_KEY_SECRET` | yes for live |
| `CDP_WALLET_SECRET` | yes for live |
| `CDP_PROJECT_ID` | optional |
| `CDP_CLIENT_API_KEY` | optional (Embedded Wallets later) |
| `CDP_WEBHOOK_SECRET` | optional |

**Never commit values. Never paste CDP keys in chat or PRs.** Ops stashes versions OOB.

Flags (not secrets):

```bash
CDP_NETWORK=base-sepolia          # default
# CDP_ALLOW_MAINNET=1             # required in addition to CDP_NETWORK=base
# CDP_DRY_RUN=1                   # documented dry-run (default in .env.example)
# CDP_DRY_RUN_LIVE=1              # Sepolia faucet + live transfers only
```

## Sepolia dry-run (after Ops stashes CDP_*)

1. Confirm the three required secrets exist in Secret Manager (names above). Do not print values.
2. Load them into the runtime env (Cloud Run secret refs, or a local shell via `gcloud secrets versions access` — keep that off git and off screenshots).
3. `@coinbase/cdp-sdk` is a runtime dependency of `apps/web`. Cloud Build / Docker `npm ci` installs it into the Cloud Run image. Local live calls need the same install:

   ```bash
   cd apps/web
   npm ci
   ```

4. Offline probe (always safe; exits 2 if secrets are missing):

   ```bash
   # repo root
   node scripts/money-path-dry-run.mjs
   ```

5. Live Base Sepolia **test USDC only**:

   ```bash
   export CDP_NETWORK=base-sepolia
   export CDP_DRY_RUN_LIVE=1
   node scripts/money-path-dry-run.mjs
   ```

   That path faucets test USDC into `gb-escrow`, then transfers 98% / 2% to `gb-hunter-dry` / `gb-fee`. It **refuses** `CDP_NETWORK=base` unless you also set `CDP_ALLOW_MAINNET=1` (do not do that in sandbox).

6. Product lock without a prior inbound tx still requires either `CDP_DRY_RUN_LIVE=1` (faucet) or an explicit fund tx hash (direct USDC / x402 `exact` to `gb-escrow`). The app will not mark `funded` on a hosted-checkout redirect.

`GET /api/health` → `escrow.missing` lists unset CDP names (no values). `escrow.hosted_checkout.enabled` is always `false`.

## Idempotency + recon

- One deterministic UUID per `(bounty_id, kind)` (`FUND_IN`, `HUNTER_PAYOUT`, `FEE_OUT`, `REFUND_OUT`). Passed through as the CDP idempotency key when the live rail runs.
- Our rows (not CDP’s 24h window) are the long-lived store. Hashes live on `escrows.fund_tx_hash` / `payout_tx_hash` / `fee_tx_hash` / `refund_tx_hash`.
- SettledPartial: retry **FEE_OUT only** with the same fee key. Never reverse a confirmed hunter payout.
- Recon hook (`reconcileBountyNotes`): attributed escrow = face − confirmed payout − confirmed fee − refund. Open bounties must equal face; `settled` / `refunded` must equal 0. Nightly: `sum(open attributed) == gb-escrow` on-chain USDC (allow in-flight). This ticket ships the notes; it does not run a chain indexer.

## APIs

| Method | Auth | Role |
| --- | --- | --- |
| Poster **Lock in escrow** on `/bounties/[id]` | Google | pending → funded + escrow lock |
| Poster **Cancel and refund** | Google | full-face refund or void if never funded |
| `POST /api/bounties/:id/settle` | Google | minimal settle (poster or hunter) |
| Hunter **Claim payout** on `/bounties/[id]` | Google | V1-6 hunter-only path; calls `settleEscrow` |
| `POST /api/bounties/:id/claim` | Google | same hunter-only claim (BYO Base address) |
| `POST /api/bounties/:id/refund` | Google | same as cancel |
| `GET\|POST /api/jobs/expire-claim-locks` | optional `CRON_SECRET` | claim-lock expiry **and** `bounties.expires_at` refunds |

There is **no default bounty TTL**. `expires_at` is honored when set. Claim-lock timeout restores `funded`; it does not move USDC.

## Hosted checkout disabled

ADR 0001 open Q: Coinbase Business Checkouts `settlement.feeAmount` may skim a merchant fee, so **net proceeds may be &lt; face F**. Until that is measured on a sandbox checkout:

- Do **not** enable hosted checkout.
- Do **not** treat checkout `COMPLETED` as an escrow hold.
- Prefer API / server-wallet fund lock: x402 `exact` or a direct USDC transfer to `gb-escrow`.

## Out of scope

- V2 participation pool
- V1-6 claim payout UI ([claims.md](claims.md))
- Multi-rail / Lightning / Solana
- Production user funds / mainnet USDC
