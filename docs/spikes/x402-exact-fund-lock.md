# Spike: fund Lock without pasting a tx hash (x402 exact)

**Date:** 2026-09-12  
**ADR:** [0002](../adr/0002-x402-exact-dev-fund.md) (follows [0001](../adr/0001-cdp-x402-wallets.md))  
**DEV:** `https://dev.githubbounties.xyz` (Cloud Run `github-bounties-web`)

Hosted Coinbase Business checkout stays **disabled**. This spike does not ship a
fake checkout UI.

## What landed

- `GET|POST /api/bounties/:id/x402` — x402 v2 `exact` seller, `payTo` = `gb-escrow`
- Pending escrow can store the settlement hash (`fund_tx_hash` + `x402_payment_id`)
- Poster **Lock in escrow** uses that recorded inbound — no paste required
- Optional `fundTxHash` paste still works
- `GET /api/health` → `escrow.x402_exact` + `escrow.hosted_checkout.enabled=false`

## Dogfood on DEV (laptop; poster Google session for Lock)

1. Create a `pending_fund` bounty on DEV (existing poster flow).
2. Challenge (no secrets in the output):

   ```bash
   curl -sS -D - "https://dev.githubbounties.xyz/api/bounties/<BOUNTY_ID>/x402" | head
   ```

   Expect **HTTP 402**, `PAYMENT-REQUIRED` header, JSON `accepts[0].scheme=exact`,
   `payTo` = `gb-escrow`, `amount` = face atomic.

3. Pay with an x402 client (Base Sepolia test USDC), then retry the same URL
   with `PAYMENT-SIGNATURE`. Expect **HTTP 200**, `inboundRecorded: true`.

   Minimal client (needs `CDP_*` on the **buyer** machine, not pasted here):

   ```bash
   # environment=development → Base Sepolia. Fund the printed EVM address with test USDC.
   node scripts/x402-fund-dogfood.mjs --url https://dev.githubbounties.xyz/api/bounties/<BOUNTY_ID>/x402
   ```

4. On the bounty page, **Lock in escrow** with the hash field empty (or
   `POST /api/bounties/<id>/fund` `{}`). Expect `funded` and the recorded hash.

5. Confirm hosted checkout is still off:

   ```bash
   curl -sS https://dev.githubbounties.xyz/api/health | jq '.escrow.hosted_checkout.enabled, .escrow.x402_exact'
   ```

DRS may 403 unauthenticated `curl` — use a browser session or an identity token.

## Ops

| Item | Action |
| --- | --- |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | Already on Cloud Run. Must be able to JWT-auth the CDP facilitator. No new SM names. |
| `CDP_WALLET_SECRET` | Already required for `gb-escrow` `getOrCreateAccount`. |
| `PUBLIC_BASE_URL` / `AUTH_URL` | Already on `dev.githubbounties.xyz`. Used as the x402 resource origin. |
| Coinbase Business checkout | **Do nothing.** Still disabled. No domain callbacks. |
| `CDP_WEBHOOK_SECRET` | Still unused (0 versions). Not required for x402 exact. |
| `CDP_ALLOW_MAINNET` | Must stay unset. Seller refuses mainnet. |

Redeploy `github-bounties-web` after merge so `@x402/core` / `@x402/evm` are in the image.

## Tests

```bash
cd apps/web
npm run test:unit   # includes src/escrow/x402.test.ts
# with DATABASE_URL:
npm run test:db     # includes src/escrow/x402.integration.test.ts
```
