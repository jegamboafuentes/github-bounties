# Spike: V1.5 fund UX (WalletConnect + amount presets)

**Date:** 2026-09-12  
**Follows:** [x402 exact fund Lock](x402-exact-fund-lock.md), [ADR 0002](../adr/0002-x402-exact-dev-fund.md)  
**DEV:** `https://dev.githubbounties.xyz`

Human path on top of #29. **Not** V2 multi-hunter. Hosted Coinbase checkout stays
**disabled**.

## What landed

- Create bounty: face chips `$1 / $5 / $10 / $50 / $100` + custom input
- Lock page (`pending_fund`, poster): show **fixed face** + WalletConnect /
  browser wallet + **Pay {face} USDC with wallet**
- One-tap: `GET /api/bounties/:id/x402` → wallet signs EIP-3009 →
  `PAYMENT-SIGNATURE` → inbound recorded → `POST /api/bounties/:id/fund` `{}`
  (auto-Lock). If auto-Lock fails, **Lock in escrow** still works with an empty
  hash.
- Advanced: collapsed paste-hash fallback
- `GET /api/health` → `escrow.walletconnect.configured` (boolean only)

## Ops: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`

This is a **public** Reown Cloud project id ([dashboard.reown.com](https://dashboard.reown.com)).
It is **not** a Secret Manager secret. Do not put `CDP_*` here.

1. Create a project. Allow origins `https://dev.githubbounties.xyz` and
   `http://localhost:3000`.
2. Export it when deploying so `deploy-web.sh` keeps it on the service:

   ```bash
   export NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID='<reown-project-id>'
   ./infra/gcloud/deploy-web.sh --apply --image ...
   ```

   Or append it to Cloud Run `--set-env-vars` (see [staging-deploy.md](../staging-deploy.md)).

3. Confirm (value must not appear):

   ```bash
   curl -sS https://dev.githubbounties.xyz/api/health \
     | jq '.escrow.walletconnect, .escrow.hosted_checkout.enabled'
   ```

   Expect `configured: true`, `hostedCheckout: "disabled"`, hosted checkout
   `enabled: false`.

Without the id, **WalletConnect QR is hidden**. Injected browser wallets
(MetaMask, etc.) still work. Paste-hash Advanced still works.

## Dogfood on DEV (Enrique)

1. Sign in with Google. Post a bounty: tap `$10` (or custom), submit. Land on
   `/bounties/<id>` with status `pending_fund`. Face is now fixed — chips do
   not change an existing bounty.
2. On Lock: **WalletConnect** (or Browser wallet) → Base Sepolia → **Pay 10 USDC
   with wallet**. Wallet prompts for USDC `TransferWithAuthorization` (gasless
   EIP-3009). Need Base Sepolia test USDC in that wallet.
3. Expect inbound recorded, then auto-Lock to `funded`. No explorer copy-paste.
4. If auto-Lock stops, tap **Lock in escrow** (empty hash).
5. Optional: Advanced → paste a direct-transfer hash (fallback unchanged).
6. Confirm hosted checkout is still off (health JSON above).

CLI probe from #29 still works: `node scripts/x402-fund-dogfood.mjs --url …`.
