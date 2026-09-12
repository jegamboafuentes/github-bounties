# ADR 0002: DEV fund Lock via x402 `exact` (no paste-hash)

- **Status:** Proposed — implement on DEV; hosted checkout stays disabled
- **Date:** 2026-09-12
- **Product:** GitHub Bounties
- **Follows:** [ADR 0001](./0001-cdp-x402-wallets.md)

## Context

Live Lock on DEV (`https://dev.githubbounties.xyz`) still required the poster to
paste `fundTxHash`. Without a hash (and without `CDP_DRY_RUN_LIVE=1`) the CDP
rail throws `inbound_unconfirmed`.

ADR 0001 chose hybrid inbound. **Hosted Coinbase Business checkout remains
DISABLED** because `settlement.feeAmount` / net proceeds may be &lt; face F
(conservation: F must land 1:1 in `gb-escrow`). That open Q is still unmeasured.

Humans and agents both need a path that does not invent a fake checkout button.

## Decision

**DEV inbound = x402 `exact` to `gb-escrow`. Hosted checkout stays off.**

| Leg | Choice | Why |
| --- | --- | --- |
| Preferred inbound | x402 `exact`, `payTo` = `gb-escrow` | Facilitator fee is billed to the CDP project, not skimmed from F. Face lands 1:1. |
| Hosted checkout | Still **disabled** | ADR 0001 open Q unchanged. Do not treat `COMPLETED` as escrow. |
| Fallback | Direct USDC + optional `fundTxHash` paste | Unchanged. Do not break it. |
| Lock confirm | Record inbound (tx hash + `x402_payment_id`) on the **pending** escrow row, then poster Lock with no paste | Recon treats `pending` as 0 attributed, so storing the hash before `funded` is safe. |

V2 multi-hunter pool is out of scope here — see [ADR 0003](./0003-v2-multi-hunter-pool.md)
(15% of post-fee, not ~15% of face). V1.5 WalletConnect + amount chips is parallel
polish after this inbound path and does not block 0003.

## Sequence (DEV)

```text
GET|POST /api/bounties/{id}/x402
  unpaid → 402 Payment Required (exact F, payTo=gb-escrow)
  PAYMENT-SIGNATURE → CDP facilitator verify + settle
  record FUND_IN hash on escrows (status stays pending)
Poster Lock (HTML or POST /api/bounties/{id}/fund) with empty hash
  lockFace uses recorded inbound → funded
```

Already-paid GET/POST returns 200 and does **not** demand a second payment.

## Consequences

- Working DEV path for agents (`CdpX402Client` / `@x402/fetch`) and for a poster
  who Locks after the 402 settle — no hash paste.
- Humans without an x402 client still use the optional paste-hash fallback.
- Ops does **not** need Coinbase Business domain callbacks for this spike.
- New runtime deps: `@x402/core`, `@x402/evm` (CDP SDK optional peers, now direct).
- Existing `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` must be allowed to call the
  CDP facilitator (`https://api.cdp.coinbase.com/platform/v2/x402`). No new
  Secret Manager names. `PUBLIC_BASE_URL` / `AUTH_URL` already on DEV.

## Not decided here

- Re-enable hosted checkout (only after a sandbox checkout proves
  `netAmount == F`).
- In-app Embedded Wallet `useX402` human paywall.
- Mainnet USDC / production user funds.
